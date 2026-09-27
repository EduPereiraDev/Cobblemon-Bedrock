/**
 * Struct MoLang de entidade (EntityMoLangFunctions + LivingEntityMoLangFunctions do Cobblemon 1.8.2) e o
 * `asMostSpecificMoLangValue` (jogador → q.player, NPC → q.npc, Pokémon → PokemonEntity).
 *
 * Sem equivalente estável no Bedrock (retornam 0): memórias do Brain (`get_*_memory`, `has_memory_value`...),
 * pathfinding por script (`walk_to`, `set_pathfinding_malus`), `is_touching_water_or_rain`/`is_in_rain` (sem
 * leitura de chuva por bloco), `is_tamable`/`is_tamed`/`is_hostile`/`is_animal` (sem categoria de mob na API) e
 * `add_callback` (sem ciclo de tick por entidade para callbacks MoLang).
 */
import type { Entity, EntityHealthComponent, Player } from "@minecraft/server";
import { MoArray, MoStruct, asNumber, asString } from "../npc/molang/MoLang";
import { argBool, argInt, bedrockSoundId } from "./GeneralFunctions";
import { createWorldStruct } from "./WorldStruct";
import { createPlayerStruct } from "../npc/PlayerStruct";
import { NPC } from "../npc/NPCEntity";
import { PokemonData } from "../Pokemon";
import { createPokemonEntityStruct } from "./PokemonStruct";

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); }
  catch { return fallback; }
}

function health(entity: Entity): EntityHealthComponent | undefined {
  return safe(() => entity.getComponent("minecraft:health"), undefined);
}

/** Holder<Biome>.asMoLangValue: `id`, `is_of(id)`, `is_in(#tag)` (tags de bioma do Bedrock). */
export function biomeStruct(entity: { dimension: Entity["dimension"]; location: Entity["location"] }): MoStruct {
  const biome = safe(() => entity.dimension.getBiome(entity.location), undefined);
  const id = biome?.id ?? "minecraft:plains";
  const bare = (value: string) => value.trim().toLowerCase().replace(/^#/, "").replace(/^minecraft:/, "");
  return new MoStruct({ id }, {
    is_of: args => (bare(asString(args[0])) === bare(id) ? 1 : 0),
    is_in: args => (safe(() => biome?.getTags().map(bare).includes(bare(asString(args[0]))) ?? false, false) ? 1 : 0),
  });
}

/**
 * q.entity de uma entidade qualquer (Entity.asMoLangValue).
 */
export function createEntityStruct(entity: Entity): MoStruct {
  const struct = new MoStruct({}, {}, entity);
  const location = () => safe(() => entity.location, { x: 0, y: 0, z: 0 });
  const velocity = () => safe(() => entity.getVelocity(), { x: 0, y: 0, z: 0 });
  struct
    .set("is_player", 0).set("is_npc", 0).set("is_pokemon", 0)
    .fn("uuid", () => entity.id)
    .fn("name", () => safe(() => entity.nameTag || entity.typeId, ""))
    .fn("type", () => entity.typeId)
    .fn("yaw", () => safe(() => entity.getRotation().y, 0))
    .fn("pitch", () => safe(() => entity.getRotation().x, 0))
    .fn("x", () => location().x)
    .fn("y", () => location().y)
    .fn("z", () => location().z)
    .fn("position", () => { const p = location(); return new MoArray([p.x, p.y, p.z]); })
    .fn("velocity_x", () => velocity().x)
    .fn("velocity_y", () => velocity().y)
    .fn("velocity_z", () => velocity().z)
    .fn("delta_movement", () => { const v = velocity(); return new MoArray([v.x, v.y, v.z]); })
    .fn("horizontal_velocity", () => { const v = velocity(); return Math.sqrt(v.x * v.x + v.z * v.z); })
    .fn("vertical_velocity", () => velocity().y)
    .fn("id_modulo", args => {
      // Entity.id do Java é um int; aqui usa o hash do id do Bedrock.
      let hash = 0;
      for (const ch of entity.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      const mod = Math.max(1, argInt(args, 0, 1));
      return ((hash % mod) + mod) % mod;
    })
    .fn("is_on_ground", () => (safe(() => entity.isOnGround, false) ? 1 : 0))
    .fn("world", () => createWorldStruct(entity.dimension))
    .fn("biome", () => biomeStruct(entity))
    .fn("is_passenger", () => (safe(() => !!entity.getComponent("minecraft:riding"), false) ? 1 : 0))
    .fn("is_riding", () => (safe(() => !!entity.getComponent("minecraft:riding"), false) ? 1 : 0))
    .fn("discard", () => { safe(() => entity.remove(), undefined); return 1; })
    .fn("is_sneaking", () => (safe(() => entity.isSneaking, false) ? 1 : 0))
    .fn("is_sprinting", () => (safe(() => entity.isSprinting, false) ? 1 : 0))
    .fn("is_in_water", () => (safe(() => entity.isInWater, false) ? 1 : 0))
    .fn("is_touching_water", () => (safe(() => entity.isInWater, false) ? 1 : 0))
    .fn("is_underwater", () => (safe(() => entity.isSwimming || entity.isInWater, false) ? 1 : 0))
    .fn("is_on_fire", () => (safe(() => !!entity.getComponent("minecraft:onfire"), false) ? 1 : 0))
    .fn("is_invisible", () => (safe(() => !!entity.getEffect("invisibility"), false) ? 1 : 0))
    .fn("is_sleeping", () => (safe(() => entity.isSleeping, false) ? 1 : 0))
    .fn("set_name", args => { safe(() => { entity.nameTag = asString(args[0]); }, undefined); return 1; })
    .fn("damage", args => { safe(() => entity.applyDamage(asNumber(args[0])), false); return 1; })
    .fn("distance_to_pos", args => {
      const p = location();
      const dx = p.x - asNumber(args[0]), dy = p.y - asNumber(args[1]), dz = p.z - asNumber(args[2]);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    })
    .fn("tags", () => new MoArray(safe(() => entity.getTags(), [] as string[])))
    .fn("add_tag", args => (safe(() => entity.addTag(asString(args[0])), false) ? 1 : 0))
    .fn("remove_tag", args => (safe(() => entity.removeTag(asString(args[0])), false) ? 1 : 0))
    .fn("has_tag", args => (safe(() => entity.hasTag(asString(args[0])), false) ? 1 : 0))
    .fn("play_animation", args => { safe(() => entity.playAnimation(asString(args[0])), undefined); return 1; })
    .fn("spawn_bedrock_particles", args => {
      const p = location();
      safe(() => entity.dimension.spawnParticle(bedrockSoundId(asString(args[0])), { x: p.x, y: p.y + 0.5, z: p.z }), undefined);
      return 1;
    })
    // LivingEntityMoLangFunctions
    .fn("is_living_entity", () => (health(entity) ? 1 : 0))
    .fn("is_mob", () => (health(entity) && entity.typeId !== "minecraft:player" ? 1 : 0))
    .fn("health", () => health(entity)?.currentValue ?? 0)
    .fn("max_health", () => health(entity)?.effectiveMax ?? 0)
    .fn("heal", args => {
      const component = health(entity);
      if (!component) return 0;
      const amount = args[0] === undefined ? component.effectiveMax : asNumber(args[0]);
      safe(() => component.setCurrentValue(Math.min(component.effectiveMax, component.currentValue + amount)), false);
      return 1;
    })
    .fn("has_effect", args => (safe(() => !!entity.getEffect(asString(args[0]).replace(/^minecraft:/, "")), false) ? 1 : 0))
    .fn("add_effect", args => {
      // add_effect(efeito, duração em ticks, amplificador, partículas visíveis)
      const effect = asString(args[0]).replace(/^minecraft:/, "");
      const ok = safe(() => !!entity.addEffect(effect, Math.max(1, argInt(args, 1, 200)), {
        amplifier: argInt(args, 2, 0), showParticles: argBool(args, 3, true),
      }), false);
      return ok ? 1 : 0;
    })
    .fn("remove_effect", args => (safe(() => entity.removeEffect(asString(args[0]).replace(/^minecraft:/, "")), false) ? 1 : 0))
    .fn("look_at_position", args => {
      safe(() => entity.lookAt({ x: asNumber(args[0]), y: asNumber(args[1]), z: asNumber(args[2]) }), undefined);
      return 1;
    })
    .fn("is_doing_activity", () => 0)
    .fn("has_walk_target", () => 0);
  return struct;
}

/** LivingEntity.asMostSpecificMoLangValue: q.player, q.npc, PokemonEntity ou entidade genérica. */
export function asMostSpecificStruct(entity: Entity): MoStruct {
  if (entity.typeId === "minecraft:player") return createPlayerStruct(entity as Player);
  const npc = safe(() => NPC.from(entity), undefined);
  if (npc) return npc.struct;
  const pokemon = safe(() => PokemonData.tryGetFromEntity(entity), undefined);
  if (pokemon) return createPokemonEntityStruct(entity, pokemon);
  return createEntityStruct(entity);
}
