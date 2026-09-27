// Regras que só o cliente Bedrock confere (o BDS não carrega o resource pack): usadas pelo importador para gerar
// conteúdo dentro dos limites, pelo validate (npm run validate) e pelos testes (tests/cliente-log.test.ts).
// Frente cliente-log: cada regra aqui corresponde a uma categoria do content log do cliente
// (docs/pendencias/cliente-log.md).

// ---------------------------------------------------------------------------------------------------------------
// Geometria de bloco (minecraft:geometry): o cliente recusa a geometria inteira (o bloco some, "cannot find
// geometry ... JSON") quando
//  - "Total length of parts for schematic '<id>' on axis <a> is greater than 1 + 14/16ths": a extensão total das
//    caixas num eixo passa de 30 px;
//  - "<id> contains N boxes outside the error bounds of (-0.875, -0.875, -0.875) to (1.875, 1.875, 1.875)": alguma
//    caixa sai de 14 px além do bloco em qualquer direção.
// O cliente mede as caixas JÁ ROTACIONADAS (wacan: 28 px sem rotação, recusada por passar de 30 px). Em coordenadas
// da geometria (x/z centrados em 0, y a partir do chão do bloco), o bloco vai de (-8, 0, -8) a (8, 16, 8).
// ---------------------------------------------------------------------------------------------------------------

/** Extensão máxima por eixo, em px (1 + 14/16 bloco). */
export const BLOCK_GEO_MAX_LENGTH = 30;
/** Limites das caixas em px nas coordenadas da geometria: (-0.875..1.875 bloco) → x/z -22..22, y -14..30. */
export const BLOCK_GEO_BOUNDS = { min: [-22, -14, -22], max: [22, 30, 22] } as const;
/** Folga usada pelo importador ao ajustar (arredondamento de rotação e de pivôs). */
export const BLOCK_GEO_MARGIN = 0.25;

type Vec = [number, number, number];
type GeoCube = { origin: number[]; size: number[]; pivot?: number[]; rotation?: number[]; inflate?: number };
type GeoBone = { name: string; parent?: string; pivot?: number[]; rotation?: number[]; cubes?: GeoCube[] };

const DEG = Math.PI / 180;

/**
 * Rotação de um ponto em torno de um pivô, como o Bedrock aplica em geometrias (graus; x e y com sinal invertido
 * em relação ao Blockbench, que espelha o eixo x; ordem Z → Y → X). Para a checagem de limites a ordem exata pesa
 * pouco: o validate confere com folga e o importador ajusta com margem.
 */
function rotate(p: Vec, pivot: Vec, rot: number[] | undefined): Vec {
	if (!rot || !rot.some((v) => v)) return p;
	let [x, y, z] = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
	const [rx, ry, rz] = [-(rot[0] ?? 0) * DEG, -(rot[1] ?? 0) * DEG, (rot[2] ?? 0) * DEG];
	// Z
	let c = Math.cos(rz), s = Math.sin(rz);
	[x, y] = [x * c - y * s, x * s + y * c];
	// Y
	c = Math.cos(ry); s = Math.sin(ry);
	[x, z] = [x * c + z * s, -x * s + z * c];
	// X
	c = Math.cos(rx); s = Math.sin(rx);
	[y, z] = [y * c - z * s, y * s + z * c];
	return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

export type Box = { min: Vec; max: Vec; bone: string };

/** Caixas (AABB dos 8 cantos já rotacionados pela hierarquia de bones) de uma geometria. */
export function geometryBoxes(bones: GeoBone[]): Box[] {
	const byName = new Map(bones.map((b) => [b.name, b]));
	const chain = (b: GeoBone): GeoBone[] => {
		const out: GeoBone[] = [];
		const seen = new Set<string>();
		for (let cur: GeoBone | undefined = b; cur && !seen.has(cur.name); cur = cur.parent ? byName.get(cur.parent) : undefined) {
			seen.add(cur.name);
			out.push(cur);
		}
		return out; // do bone até a raiz
	};
	const boxes: Box[] = [];
	for (const bone of bones) {
		if (!bone.cubes?.length) continue;
		const bones_ = chain(bone);
		for (const c of bone.cubes) {
			const inf = c.inflate ?? 0;
			const lo = [0, 1, 2].map((i) => c.origin[i] - inf);
			const hi = [0, 1, 2].map((i) => c.origin[i] + c.size[i] + inf);
			const min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
			for (let k = 0; k < 8; k++) {
				let p: Vec = [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]];
				p = rotate(p, (c.pivot ?? [0, 0, 0]) as Vec, c.rotation);
				for (const b of bones_) p = rotate(p, (b.pivot ?? [0, 0, 0]) as Vec, b.rotation);
				for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
			}
			boxes.push({ min, max, bone: bone.name });
		}
	}
	return boxes;
}

export type BlockGeometryCheck = { length: Vec; min: Vec; max: Vec; outside: number; problems: string[] };

/** Confere uma geometria de bloco contra os limites do cliente. `margin` > 0 exige folga (px). */
export function checkBlockGeometry(bones: GeoBone[], margin = 0): BlockGeometryCheck {
	const boxes = geometryBoxes(bones);
	const min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
	let outside = 0;
	for (const b of boxes) {
		for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }
		if ([0, 1, 2].some((i) => b.min[i] < BLOCK_GEO_BOUNDS.min[i] + margin || b.max[i] > BLOCK_GEO_BOUNDS.max[i] - margin)) outside++;
	}
	const length: Vec = boxes.length ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : [0, 0, 0];
	const problems: string[] = [];
	["x", "y", "z"].forEach((axis, i) => {
		if (length[i] > BLOCK_GEO_MAX_LENGTH - margin) problems.push(`extensão no eixo ${axis} de ${length[i].toFixed(2)} px > ${BLOCK_GEO_MAX_LENGTH} px (1 + 14/16 bloco)`);
	});
	if (outside) problems.push(`${outside} caixa(s) fora dos limites (-0.875..1.875 bloco: x/z -22..22 px, y -14..30 px)`);
	return { length, min, max, outside, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Features (worldgen): no Bedrock as variáveis de coordenada existem só onde o motor as define. Em
// minecraft:scatter_feature, `v.worldx/v.worldy/v.worldz` só existem DENTRO de x/y/z da distribution (e são a
// coordenada do próprio eixo sendo avaliado e das avaliadas antes, na ordem de coordinate_eval_order). Fora disso
// (iterations, scatter_chance, e o y avaliado ANTES de x/z) o cliente acusa "unhandled request for unknown variable
// 'variable.worldx'" a cada chunk. v.originx/originy/originz valem em toda a feature.
// ---------------------------------------------------------------------------------------------------------------

const COORD_VARS = /\b(?:v|variable)\.world([xyz])\b/gi;

/** O y da distribuição depende de v.worldx/v.worldz (ex.: q.heightmap(v.worldx, v.worldz)): exige ordem "xzy". */
export function heightDependsOnXz(y: unknown): boolean {
	return /\b(?:v|variable)\.world[xz]\b/i.test(typeof y === "string" ? y : JSON.stringify(y ?? ""));
}

/**
 * Problemas de uso de v.worldx/y/z numa distribuição de scatter (minecraft:scatter_feature ou `distribution` de
 * feature_rules): cada eixo só enxerga os eixos avaliados antes dele na coordinate_eval_order (padrão "xzy") e o
 * próprio eixo não existe durante a sua avaliação; iterations/scatter_chance não enxergam nenhum.
 */
export function checkScatterFeatureMolang(scatter: any): string[] {
	const problems: string[] = [];
	if (!scatter || typeof scatter !== "object") return problems;
	const order: string = typeof scatter.coordinate_eval_order === "string" ? scatter.coordinate_eval_order : "xzy";
	const axesOf = (v: unknown) => [...(typeof v === "string" ? v : JSON.stringify(v ?? "")).matchAll(COORD_VARS)].map((m) => m[1].toLowerCase());
	for (const k of ["iterations", "scatter_chance"]) {
		for (const used of new Set(axesOf(scatter[k]))) problems.push(`${k} usa v.world${used} (só existe dentro de x/y/z)`);
	}
	for (const axis of ["x", "y", "z"]) {
		const available = new Set(order.slice(0, Math.max(0, order.indexOf(axis))).split(""));
		for (const used of new Set(axesOf(scatter[axis]))) {
			if (!available.has(used)) problems.push(`${axis} usa v.world${used}, que ainda não existe (coordinate_eval_order "${order}"; o cliente acusa "unknown variable 'variable.world${used}'")`);
		}
	}
	return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Partículas: o que o cliente recusa em particle_effect (componentes, eventos de som, campos obrigatórios).
// ---------------------------------------------------------------------------------------------------------------

/**
 * "Event name 'x' is not a valid LevelSoundEvent": o `sound_effect.event_name` dos eventos de partícula é o nome de
 * um LevelSoundEvent do motor (documentation/Particles.html: "name of the level sound event"), não um evento de
 * sound_definitions. Os de partícula vanilla são desses (block.beehive.drip, drip.lava.pointed_dripstone). Lista:
 * chaves "events" do resource_pack/sounds.json vanilla (bedrock-samples v1.26.50.4), que são LevelSoundEvents.
 * Sons do Cobblemon em partículas são tocados pelo script (particleSounds.ts) ou pela animação.
 */
export const LEVEL_SOUND_EVENTS: ReadonlySet<string> = new Set((
	"absorb_block activate add.chest admire agitated ambient ambient.aggressive ambient.baby " +
	"ambient.basalt_deltas.additions ambient.basalt_deltas.loop ambient.basalt_deltas.mood ambient.candle " +
	"ambient.cave ambient.crimson_forest.additions ambient.crimson_forest.loop ambient.crimson_forest.mood " +
	"ambient.in.air ambient.in.raid ambient.in.water ambient.nether_wastes.additions ambient.nether_wastes.loop " +
	"ambient.nether_wastes.mood ambient.pollinate ambient.screamer ambient.soulsand_valley.additions " +
	"ambient.soulsand_valley.loop ambient.soulsand_valley.mood ambient.tame ambient.underwater.enter " +
	"ambient.underwater.exit ambient.warped_forest.additions ambient.warped_forest.loop ambient.warped_forest.mood " +
	"ambient.weather.the_end_light_flash ambient.worried angry apply_effect.bad_omen apply_effect.raid_omen " +
	"apply_effect.trial_omen armor armor.break_wolf armor.crack_wolf armor.equip_chain armor.equip_copper " +
	"armor.equip_diamond armor.equip_elytra armor.equip_generic armor.equip_gold armor.equip_iron " +
	"armor.equip_leather armor.equip_netherite armor.equip_wolf armor.repair_wolf armor.unequip_generic " +
	"armor.unequip_wolf attach attack attack.critical attack.nodamage attack.strong beacon.activate beacon.ambient " +
	"beacon.deactivate beacon.power blast block.bamboo_sapling.place block.barrel.close block.barrel.open " +
	"block.beehive.drip block.beehive.enter block.beehive.exit block.beehive.shear block.beehive.work " +
	"block.bell.hit block.blastfurnace.fire_crackle block.campfire.crackle block.cartography_table.use block.click " +
	"block.click.fail block.composter.empty block.composter.fill block.composter.fill_success block.composter.ready " +
	"block.copper_bulb.turn_off block.copper_bulb.turn_on block.creaking_heart.trail block.decorated_pot.insert " +
	"block.decorated_pot.insert_fail block.enchanting_table.use block.end_portal.spawn block.end_portal_frame.fill " +
	"block.fletching_table.use block.frog_spawn.break block.frog_spawn.hatch block.furnace.lit block.grindstone.use " +
	"block.loom.use block.scaffolding.climb block.sculk.spread block.sculk_catalyst.bloom block.sculk_sensor.place " +
	"block.sculk_shrieker.place block.sculk_shrieker.shriek block.sign.waxed_interact_fail block.smithing_table.use " +
	"block.smoker.smoke block.sniffer_egg.crack block.sniffer_egg.hatch block.stonecutter.use " +
	"block.sweet_berry_bush.hurt block.sweet_berry_bush.pick block.turtle_egg.attack block.turtle_egg.break " +
	"block.turtle_egg.crack block.turtle_egg.hatch boost born bottle.dragonbreath bottle.empty bottle.fill bounce " +
	"bow bow.hit break break.block break_pot breathe breeze_wind_charge.burst brush brush_completed bubble.down " +
	"bubble.downinside bubble.pop bubble.up bubble.upinside bucket.empty.fish bucket.empty.land_animal " +
	"bucket.empty.lava bucket.empty.powder_snow bucket.empty.water bucket.fill.fish bucket.fill.land_animal " +
	"bucket.fill.lava bucket.fill.powder_snow bucket.fill.water bullet.hit bundle.drop_contents bundle.insert " +
	"bundle.insert_fail bundle.remove_one burp button.click_off button.click_on cake.add_candle camera.take_picture " +
	"cant_breed cast.spell cauldron_drip.lava.pointed_dripstone cauldron_drip.water.pointed_dripstone celebrate " +
	"charge charge.sculk chest.closed chest.open chime.amethyst_block chorusdeath chorusgrow close close_long " +
	"conduit.activate conduit.ambient conduit.attack conduit.deactivate conduit.short convert_mooshroom " +
	"convert_to_drowned convert_to_frog convert_to_stray converted_to_zombified copper.wax.off copper.wax.on " +
	"crafter.craft crafter.disable_slot crafter.fail creaking_heart_spawn crossbow.loading.end " +
	"crossbow.loading.middle crossbow.loading.start crossbow.quick_charge.end crossbow.quick_charge.middle " +
	"crossbow.quick_charge.start crossbow.shoot dash_ready deactivate death death.baby death.in.water " +
	"death.mid.volume death.min.volume death.screamer death.to.zombie deny detach disappeared dismount door.close " +
	"door.open drink drink.honey drink.milk drip.lava.pointed_dripstone drip.water.pointed_dripstone drop.slot eat " +
	"eject_block elderguardian.curse enderchest.closed enderchest.open explode extinguish.candle extinguish.fire " +
	"fall fall.big fall.small fang fence_gate.close fence_gate.open fire fizz flap flop fly freeze fuse gallop " +
	"geyser_continuous_eruption_active geyser_continuous_eruption_start geyser_eruption_active " +
	"geyser_eruption_start glass glow_squid.ink_squirt growl haggle haggle.no haggle.yes heartbeat heavy.step hit " +
	"horn_break horn_call0 horn_call1 horn_call2 horn_call3 horn_call4 horn_call5 horn_call6 horn_call7 hurt " +
	"hurt.baby hurt.in.water hurt.reduced hurt.screamer ignite imitate.blaze imitate.bogged imitate.breeze " +
	"imitate.camel_husk imitate.cave_spider imitate.creaking imitate.creeper imitate.drowned imitate.elder_guardian " +
	"imitate.ender_dragon imitate.enderman imitate.endermite imitate.evocation_illager imitate.ghast " +
	"imitate.guardian imitate.happy_ghast imitate.husk imitate.magma_cube imitate.parched imitate.phantom " +
	"imitate.pillager imitate.polar_bear imitate.ravager imitate.shulker imitate.silverfish imitate.skeleton " +
	"imitate.slime imitate.spider imitate.stray imitate.vex imitate.vindication_illager imitate.warden " +
	"imitate.witch imitate.wither imitate.wither_skeleton imitate.wolf imitate.zoglin imitate.zombie " +
	"imitate.zombie_pigman imitate.zombie_villager insert insert_enchanted irongolem.crack irongolem.repair " +
	"item.book.put item.copper_spear.attack_hit item.copper_spear.attack_miss item.copper_spear.use " +
	"item.diamond_spear.attack_hit item.diamond_spear.attack_miss item.diamond_spear.use item.enchant.lunge1 " +
	"item.enchant.lunge2 item.enchant.lunge3 item.golden_spear.attack_hit item.golden_spear.attack_miss " +
	"item.golden_spear.use item.iron_spear.attack_hit item.iron_spear.attack_miss item.iron_spear.use " +
	"item.netherite_spear.attack_hit item.netherite_spear.attack_miss item.netherite_spear.use item.shield.block " +
	"item.spear.attack_hit item.spear.attack_miss item.spear.use item.spyglass.stop_using item.spyglass.use " +
	"item.stone_spear.attack_hit item.stone_spear.attack_miss item.stone_spear.use item.trident.hit " +
	"item.trident.hit_ground item.trident.return item.trident.riptide_1 item.trident.riptide_2 " +
	"item.trident.riptide_3 item.trident.throw item.trident.thunder item.use.on item.wooden_spear.attack_hit " +
	"item.wooden_spear.attack_miss item.wooden_spear.use item_given item_taken item_thrown jump jump_to_block land " +
	"large.blast launch lava lava.pop lay_egg lay_spawn lead.break lead.leash lead.unleash leashknot.break " +
	"leashknot.place levelup listening listening_angry lodestone_compass.link_compass_to_lodestone " +
	"mace.heavy_smash_ground mace.smash_air mace.smash_ground mad milk milk.screamer milk_suspiciously " +
	"mob.armadillo.brush mob.armadillo.scute_drop mob.armor_stand.place mob.hoglin.converted_to_zombified " +
	"mob.husk.convert_to_zombie mob.pig.death mob.player.hurt_drown mob.player.hurt_freeze mob.player.hurt_on_fire " +
	"mob.warning mount multi_swap nearby_close nearby_closer nearby_closest note note.bass ominous_bottle.end_use " +
	"ominous_item_spawner.about_to_spawn_item ominous_item_spawner.spawn_item ominous_item_spawner.spawn_item_begin " +
	"open open_long panic pant particle.soul_escape.loud particle.soul_escape.quiet pause_growth " +
	"pick_berries.cave_vines pickup pickup_enchanted piston.in piston.out place place_in_water place_item plop pop " +
	"portal portal.travel potion.brewed power.off power.off.sculk_sensor power.on power.on.sculk_sensor pre_ram " +
	"pre_ram.screamer prepare.attack prepare.summon prepare.wololo presneeze pressure_plate.click_off " +
	"pressure_plate.click_on pumpkin.carve purr purreow pushed_by_player raid.horn ram_impact ram_impact.screamer " +
	"random.anvil_use reappeared record.11 record.13 record.5 record.blocks record.bounce record.cat record.chirp " +
	"record.creator record.creator_music_box record.far record.lava_chicken record.mall record.mellohi " +
	"record.otherside record.pigstep record.precipice record.relic record.stal record.strad record.tears " +
	"record.wait record.ward reflect remedy reset_growth respawn_anchor.ambient respawn_anchor.charge " +
	"respawn_anchor.deplete respawn_anchor.set_spawn retreat roar saddle saddle_in_water scrape screech shake " +
	"shatter_pot shear shoot shulker.close shulker.open shulkerbox.closed shulkerbox.open single_swap sleep " +
	"slime_landing smithing_table.use sneeze sonic_boom sonic_charge spawn splash sponge.absorb squid.ink_squirt " +
	"squish.big squish.small stare state_change step step.baby step_lava step_sand straw_bed.break_leave stun swim " +
	"swoop takeoff teleport tempt thorns throw thunder tilt_down.big_dripleaf tilt_up.big_dripleaf tongue " +
	"trapdoor.close trapdoor.open trial_spawner.ambient trial_spawner.ambient_ominous trial_spawner.charge_activate " +
	"trial_spawner.close_shutter trial_spawner.detect_player trial_spawner.eject_item trial_spawner.open_shutter " +
	"trial_spawner.spawn_mob tripod twinkle ui.cartography_table.take_result ui.loom.take_result " +
	"ui.stonecutter.take_result unfect unfreeze unsaddle vault.activate vault.ambient vault.close_shutter " +
	"vault.deactivate vault.eject_item vault.insert_item vault.insert_item_fail vault.open_shutter " +
	"vault.reject_rewarded_player warn water whine wind_charge.burst"
).split(" ").filter(Boolean));

/** Componentes de partícula do Bedrock (particle_effect.components). Qualquer outro (ex.: "cobblemon:*") é recusado. */
export const PARTICLE_COMPONENTS = new Set<string>([
	"minecraft:emitter_initialization", "minecraft:emitter_local_space", "minecraft:emitter_rate_instant",
	"minecraft:emitter_rate_steady", "minecraft:emitter_rate_manual", "minecraft:emitter_lifetime_looping",
	"minecraft:emitter_lifetime_once", "minecraft:emitter_lifetime_expression", "minecraft:emitter_lifetime_events",
	"minecraft:emitter_shape_point", "minecraft:emitter_shape_sphere", "minecraft:emitter_shape_box",
	"minecraft:emitter_shape_custom", "minecraft:emitter_shape_entity_aabb", "minecraft:emitter_shape_disc",
	"minecraft:particle_initial_spin", "minecraft:particle_initial_speed", "minecraft:particle_initialization",
	"minecraft:particle_lifetime_expression", "minecraft:particle_lifetime_events", "minecraft:particle_kill_plane",
	"minecraft:particle_expire_if_in_blocks", "minecraft:particle_expire_if_not_in_blocks",
	"minecraft:particle_motion_dynamic", "minecraft:particle_motion_parametric", "minecraft:particle_motion_collision",
	"minecraft:particle_appearance_billboard", "minecraft:particle_appearance_tinting",
	"minecraft:particle_appearance_lighting",
]);

/** Raio máximo de colisão aceito pelo cliente ("radius is too large, clamping to 0.5"). */
export const PARTICLE_MAX_COLLISION_RADIUS = 0.5;

/** Chaves de partícula cujo valor é nome (textura, id, material), não Molang. */
const NAME_KEYS = new Set(["texture", "material", "effect", "identifier", "type", "event_name", "event", "mode", "facing_camera_mode", "direction", "log"]);

/**
 * Molang que o cliente recusa em partícula: parênteses sem par ("found multiple operations without a combining
 * operation"), vírgula fora de argumentos, math.max/min com mais de 2 argumentos ("Could not reduce sub-expression")
 * e q.entity_* (não existe em partícula: "Failed to resolve query query.entity_radius").
 */
export function particleMolangProblems(expr: string): string[] {
	const problems: string[] = [];
	for (const st of expr.split(";")) {
		let depth = 0;
		let quote = false;
		const stack: number[] = [];
		for (let i = 0; i < st.length; i++) {
			const c = st[i];
			if (c === "'") quote = !quote;
			if (quote) continue;
			if (c === "(") { depth++; stack.push(i); }
			else if (c === ")") {
				if (depth === 0) { problems.push("\")\" sem \"(\""); break; }
				depth--;
				stack.pop();
			} else if (c === "," && depth === 0) { problems.push("vírgula fora de argumentos"); break; }
		}
		if (depth > 0) problems.push("\"(\" sem \")\"");
	}
	for (const m of expr.matchAll(/\bmath\.(max|min)\s*\(/gi)) {
		// Conta argumentos no nível do próprio parêntese.
		let depth = 0, args = 1;
		for (let i = m.index! + m[0].length; i < expr.length; i++) {
			const c = expr[i];
			if (c === "(") depth++;
			else if (c === ")") { if (depth === 0) break; depth--; }
			else if (c === "," && depth === 0) args++;
		}
		if (args > 2) problems.push(`math.${m[1].toLowerCase()} com ${args} argumentos (o Bedrock aceita 2)`);
	}
	for (const m of expr.matchAll(/\b(?:q|query)\.entity_(width|height|size|radius|scale)\b/gi)) problems.push(`q.entity_${m[1]} não existe em partícula (use v.entity_${m[1]})`);
	return problems;
}

/** Problemas que o cliente acusa numa partícula (componentes, colisão, flipbook, eventos de som). */
export function checkParticle(j: any): string[] {
	const problems: string[] = [];
	const pe = j?.particle_effect;
	if (!pe) return problems;
	for (const [name, comp] of Object.entries<any>(pe.components ?? {})) {
		if (!PARTICLE_COMPONENTS.has(name)) problems.push(`componente desconhecido do cliente: ${name}`);
		if (name === "minecraft:particle_motion_collision") {
			if (comp?.collision_radius === undefined) problems.push("particle_motion_collision sem collision_radius (obrigatório)");
			else if (typeof comp.collision_radius === "number" && comp.collision_radius > PARTICLE_MAX_COLLISION_RADIUS) problems.push(`collision_radius ${comp.collision_radius} > ${PARTICLE_MAX_COLLISION_RADIUS}`);
		}
		if (name === "minecraft:particle_appearance_billboard") {
			const fb = comp?.uv?.flipbook;
			if (fb) {
				if (fb.max_frame === undefined) problems.push("flipbook sem max_frame (obrigatório)");
				// base_UV/size_UV aceitam Molang; step_UV só número ("Expected Number").
				if (fb.step_UV !== undefined && (!Array.isArray(fb.step_UV) || fb.step_UV.some((x: unknown) => typeof x !== "number"))) problems.push("flipbook.step_UV precisa ser [número, número]");
				for (const k of ["loop", "stretch_to_lifetime"]) if (fb[k] !== undefined && typeof fb[k] !== "boolean") problems.push(`flipbook.${k} precisa ser booleano`);
			}
		}
	}
	// Molang que o parser do Bedrock recusa (o do Snowstorm tolera).
	const seen = new Set<string>();
	const visit = (v: any, key: string) => {
		if (typeof v === "string") {
			if (NAME_KEYS.has(key) || /^[a-z_]+$/i.test(v) || seen.has(v)) return;
			seen.add(v);
			for (const p of particleMolangProblems(v)) problems.push(`Molang "${v.slice(0, 80)}": ${p}`);
		} else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
	};
	visit(pe.components ?? {}, "");
	visit(pe.curves ?? {}, "");
	for (const ev of Object.values<any>(pe.events ?? {})) visit(ev, "");
	for (const [name, ev] of Object.entries<any>(pe.events ?? {})) {
		const walk = (node: any) => {
			if (!node || typeof node !== "object") return;
			const snd = node.sound_effect?.event_name;
			if (typeof snd === "string" && !LEVEL_SOUND_EVENTS.has(snd)) problems.push(`evento ${name}: '${snd}' não é LevelSoundEvent`);
			for (const k of ["sequence", "randomize"]) for (const c of node[k] ?? []) walk(c);
		};
		walk(ev);
	}
	return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Sons: "sounds/sound_definitions.json Invalid asset path sounds/x" para qualquer definição (gerada ou escrita à mão;
// o build mescla as duas) cujo arquivo não exista no pack montado.
// ---------------------------------------------------------------------------------------------------------------

/** Definições cujo arquivo de som não existe (`exists(name)` confere .ogg/.wav/.fsb na árvore mesclada). */
export function checkSoundDefinitions(defs: Record<string, any>, exists: (name: string) => boolean): string[] {
	const problems: string[] = [];
	for (const [k, v] of Object.entries<any>(defs ?? {})) {
		for (const s of v?.sounds ?? []) {
			const name = typeof s === "string" ? s : s?.name;
			if (typeof name !== "string") problems.push(`som sem nome: ${k}`);
			else if (!exists(name)) problems.push(`som sem arquivo (o cliente acusa "Invalid asset path"): ${k} → ${name}`);
		}
	}
	return problems;
}
