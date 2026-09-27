/**
 * Raios e imunidades de Pokémon (PokemonEntity.thunderHit, canFreeze e LightningBoltMixin do 1.8.2).
 *
 * - Raio: tipo Terra não leva dano; Lightning Rod → Força II por 60 s, Motor Drive → Velocidade II por 60 s,
 *   Volt Absorb → cura instantânea II; os três ficam imunes e o fogo do raio em volta (±2 blocos) é apagado.
 *   `behaviour.lightningHit.rotateFeatures` (Mooshtank: vermelho ↔ marrom) gira a feature uma vez por raio, com o
 *   som de conversão do mooshroom, e o Pokémon fica imune ao resto daquele raio.
 * - Congelamento (neve fofa): tipo Gelo ou `behaviour.freezeImmune` não levam dano de frio.
 * - Sweet berry bush e neve fofa das raposas (apply_fox_properties) estão no JSON da entidade (importador).
 * - Teia (immuneToCobwebBlock): NÃO POSSÍVEL igual — o Bedrock não deixa um mob ignorar a lentidão da teia.
 */
import { Entity, EntityDamageCause, EntityHurtBeforeEvent, system, Vector3, world } from "@minecraft/server";
import { FREEZE_IMMUNE_SPECIES, LIGHTNING_ROTATE } from "../../generated/scripts/mundoDetalhes";
import { PokemonData } from "../Pokemon";

const FREEZE_IMMUNE = new Set(FREEZE_IMMUNE_SPECIES);

export type LightningOutcome = "damage" | "type_immune" | "lightningrod" | "motordrive" | "voltabsorb";

/** Resultado do raio pela habilidade/tipos (ordem do thunderHit: tipo e habilidade decidem juntos a imunidade). */
export function lightningOutcome(types: readonly string[], ability: string): LightningOutcome {
  const id = ability.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (id === "lightningrod" || id === "motordrive" || id === "voltabsorb") return id;
  if (types.map(t => t.toLowerCase()).includes("ground")) return "type_immune";
  return "damage";
}

/** Próximo valor da cadeia (rotateFeatures). undefined se o valor atual não faz parte da cadeia. */
export function rotateFeature(aspects: readonly string[], key: string, chain: readonly string[]): string[] | undefined {
  const prefix = `${key}-`;
  const current = aspects.find(a => a.startsWith(prefix));
  if (!current) return undefined;
  const index = chain.indexOf(current.slice(prefix.length));
  if (index < 0) return undefined;
  const next = `${prefix}${chain[(index + 1) % chain.length]}`;
  return aspects.map(a => (a === current ? next : a));
}

/** Tipo Gelo ou freezeImmune: sem dano de congelamento (canFreeze). */
export function isFreezeImmune(species: string, types: readonly string[], formFreezeImmune?: boolean): boolean {
  return types.map(t => t.toLowerCase()).includes("ice") || formFreezeImmune === true || FREEZE_IMMUNE.has(species);
}

function isPokemon(entity: Entity): boolean {
  try {
    return entity.typeId.startsWith("cobblemon:") && entity.getProperty("cobblemon:initialized") === true;
  }
  catch {
    return false;
  }
}

/** Último raio que já girou a feature de cada Pokémon (o raio acerta várias vezes). */
const lastBolt = new Map<string, string>();

function clearFireAround(dimensionId: string, center: Vector3) {
  const dimension = world.getDimension(dimensionId);
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    try {
      const block = dimension.getBlock({ x: Math.floor(center.x) + dx, y: Math.floor(center.y) + dy, z: Math.floor(center.z) + dz });
      if (block?.typeId === "minecraft:fire") block.setType("minecraft:air");
    }
    catch { /* fora do mundo carregado */ }
  }
}

function onLightning(event: EntityHurtBeforeEvent, data: PokemonData) {
  const entity = event.hurtEntity;
  const bolt = event.damageSource.damagingEntity;
  const boltId = bolt?.id ?? `t${system.currentTick}`;
  const species = data.species.toLowerCase();
  // rotateFeatures (Mooshtank): gira uma vez por raio e ignora o resto dele.
  const rotations = LIGHTNING_ROTATE[species];
  if (rotations && lastBolt.get(entity.id) === boltId) {
    event.cancel = true;
    return;
  }
  let rotated: string[] | undefined;
  if (rotations) {
    let aspects: string[] = [...data.aspects];
    for (const r of rotations) aspects = rotateFeature(aspects, r.key, r.chain) ?? aspects;
    if (aspects.join() !== data.aspects.join()) rotated = aspects;
  }
  const outcome = lightningOutcome(data.getTypes(), data.ability);
  if (outcome === "damage" && !rotated) return;
  event.cancel = true;
  const dimensionId = entity.dimension.id;
  const boltLocation = bolt?.location ?? entity.location;
  const entityId = entity.id;
  if (rotated) lastBolt.set(entityId, boltId);
  system.run(() => {
    const target = world.getEntity(entityId);
    if (!target?.isValid) return;
    try { target.extinguishFire(false); }
    catch { /* sem fogo */ }
    if (outcome === "lightningrod") target.addEffect("strength", 1200, { amplifier: 1 });
    else if (outcome === "motordrive") target.addEffect("speed", 1200, { amplifier: 1 });
    else if (outcome === "voltabsorb") target.addEffect("instant_health", 1, { amplifier: 1 });
    if (outcome === "lightningrod" || outcome === "motordrive" || outcome === "voltabsorb") {
      // LightningBoltMixin.spawnFire: sem fogo em volta de quem absorveu o raio.
      clearFireAround(dimensionId, boltLocation);
      system.runTimeout(() => clearFireAround(dimensionId, boltLocation), 2);
    }
    if (rotated) {
      const fresh = PokemonData.tryGetFromEntity(target);
      if (!fresh) return;
      fresh.aspects = rotated;
      fresh.applyToCobblemon(target);
      const owner = fresh.tryGetOwner(target);
      if (owner) fresh.tryUpdatePokemonInTeam(owner);
      target.dimension.playSound("mob.mooshroom.convert", target.location, { volume: 2 });
    }
  });
}

let started = false;

export function startLightningAndImmunities() {
  if (started) return;
  started = true;
  world.beforeEvents.entityHurt.subscribe(event => {
    const cause = event.damageSource.cause;
    if (cause !== EntityDamageCause.lightning && cause !== EntityDamageCause.freezing && cause !== EntityDamageCause.fireTick) return;
    const entity = event.hurtEntity;
    if (!isPokemon(entity)) return;
    if (cause === EntityDamageCause.fireTick) {
      // Fogo aceso pelo raio num Pokémon imune (o Java nem acende: thunderHit não roda).
      if (lastImmune.has(entity.id)) event.cancel = true;
      return;
    }
    const data = PokemonData.tryGetFromEntity(entity);
    if (!data) return;
    if (cause === EntityDamageCause.freezing) {
      const form = data.getFormData() as { behaviour?: { freezeImmune?: boolean } } | undefined;
      if (isFreezeImmune(data.species.toLowerCase(), data.getTypes(), form?.behaviour?.freezeImmune)) event.cancel = true;
      return;
    }
    onLightning(event, data);
    if (event.cancel) {
      lastImmune.add(entity.id);
      system.runTimeout(() => lastImmune.delete(entity.id), 200);
    }
  });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => lastBolt.delete(removedEntityId));
}

/** Pokémon que acabaram de absorver um raio (o fogo que o Bedrock acende neles é ignorado por 10 s). */
const lastImmune = new Set<string>();
