/**
 * Struct MoLang do mundo (WorldMoLangFunctions do Cobblemon 1.8.2): `q.player.world`, `q.entity.world`,
 * `q.pokemon.entity.world`. Cada chamada lê o estado na hora (nada é varrido por tick).
 *
 * Diferenças do Java:
 * - chuva/neve: a API estável não expõe o clima (Dimension.getWeather é beta); vem de scripts/utils/World.ts
 *   (evento weatherChange). `is_raining_at`/`is_snowing_at` pedem céu aberto (bloco mais alto abaixo da posição) e,
 *   para neve, bioma com tag `frozen`/`cold` (o Bedrock não expõe a precipitação do bioma);
 * - `server`: não há struct de servidor no Bedrock (retorna 0);
 * - `spawn_explosion`: o tipo de interação do Java vira `breaksBlocks` (NONE = não quebra);
 * - `spawn_loot_table_items`: LootTableManager estável; `minecraft:chests/x` → `chests/x`, outros namespaces
 *   tentam `<namespace>/<caminho>` e depois `<caminho>`.
 */
import { Dimension, Player, Vector3, WeatherType, world } from "@minecraft/server";
import { MoArray, MoStruct, MoValue, asNumber, asString } from "../npc/molang/MoLang";
import { getWeather } from "../utils/World";
import { TIME_RANGES } from "../entity/Sleep";
import { PokemonProperties } from "../PokemonProperties";
import { createPokemonFromProperties } from "../GUI/PokemonEdit";
import { spawnNPC } from "../npc/NPCEntity";
import { asBlockPos } from "../npc/PlayerStruct";
import { argInt, argNumber, bedrockSoundId, withNamespace } from "./GeneralFunctions";
import { createItemStackStruct } from "./ItemStackStruct";
import { asMostSpecificStruct } from "./EntityStruct";

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); }
  catch { return fallback; }
}

/** Número lido da API (fallback se falhar ou não for número). */
function numberOr(read: () => unknown, fallback: number): number {
  const value = safe(read, fallback);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function position(args: MoValue[], start = 0): Vector3 {
  return { x: asNumber(args[start]), y: asNumber(args[start + 1]), z: asNumber(args[start + 2]) };
}

function blockPosition(args: MoValue[], start = 0): Vector3 {
  return { x: Math.floor(asNumber(args[start])), y: Math.floor(asNumber(args[start + 1])), z: Math.floor(asNumber(args[start + 2])) };
}

/** Jogador pelo uuid/nome (StringValue) ou struct q.player (ObjectValue). */
export function playerFromValue(value: MoValue | undefined): Player | undefined {
  if (value === undefined) return undefined;
  if (value instanceof MoStruct) return value.host && (value.host as Player).typeId === "minecraft:player" ? value.host as Player : undefined;
  const text = asString(value);
  return safe(() => world.getAllPlayers().find(p => p.id === text || p.name === text), undefined);
}

/** TimeRange.contains com os intervalos do Cobblemon (inclusivos). */
export function isTimeOfDay(name: string, time: number): boolean {
  const ranges = TIME_RANGES[name.toLowerCase()];
  return !!ranges && ranges.some(([min, max]) => time >= min && time <= max);
}

function isRaining(dimension: Dimension): boolean {
  const weather = safe(() => getWeather(dimension), WeatherType.Clear);
  return weather === WeatherType.Rain || weather === WeatherType.Thunder;
}

/** Nada acima da posição (Level.canSeeSky + heightmap MOTION_BLOCKING). */
function isOpenSky(dimension: Dimension, pos: Vector3): boolean {
  const top = safe(() => dimension.getTopmostBlock({ x: pos.x, z: pos.z }), undefined);
  return !top || top.location.y < pos.y;
}

/** Caminho do LootTableManager para um id de loot table do Java. */
export function lootTablePaths(id: string): string[] {
  const full = withNamespace(id, "minecraft");
  const [namespace, path] = full.split(":");
  return namespace === "minecraft" ? [path] : [`${namespace}/${path}`, path];
}

/** Holder<Block>.asMoLangValue: `id`, `is_of(id)`, `is_in(#tag)` (tags do bloco no Bedrock). */
function blockStruct(dimension: Dimension, pos: Vector3): MoStruct {
  const block = safe(() => dimension.getBlock(pos), undefined);
  const id = block?.typeId ?? "minecraft:air";
  return new MoStruct({ id }, {
    is_of: args => (withNamespace(asString(args[0]), "minecraft") === id ? 1 : 0),
    is_in: args => {
      const tag = asString(args[0]).replace(/^#/, "");
      return safe(() => !!block && (block.hasTag(tag) || block.hasTag(tag.replace(/^minecraft:/, ""))), false) ? 1 : 0;
    },
  }, block);
}

/** PokemonProperties.createEntity: cria o Pokémon (como o /spawnpokemon) e o coloca no mundo como selvagem. */
function spawnWildPokemon(dimension: Dimension, pos: Vector3, properties: string) {
  const props = PokemonProperties.parse(properties);
  if (!props.species) return undefined;
  const pokemon = createPokemonFromProperties(props);
  const entity = dimension.spawnEntity(pokemon.getEntityId(), pos);
  pokemon.applyToCobblemon(entity);
  entity.setProperty("cobblemon:wild", true);
  entity.triggerEvent("cobblemon:set_wild");
  return entity;
}

export function createWorldStruct(dimension: Dimension): MoStruct {
  const struct = new MoStruct({}, {}, dimension);
  struct
    .fn("dimension", () => dimension.id)
    .fn("is_time_of_day", args => (isTimeOfDay(asString(args[0]), numberOr(() => world.getTimeOfDay(), 0)) ? 1 : 0))
    .fn("game_time", () => numberOr(() => world.getAbsoluteTime(), 0))
    .fn("time_of_day", () => numberOr(() => world.getTimeOfDay(), 0))
    // MinecraftServer.asMoLangValue: sem equivalente no Bedrock.
    .fn("server", () => 0)
    .fn("is_raining", () => (isRaining(dimension) ? 1 : 0))
    .fn("is_thundering", () => (safe(() => getWeather(dimension), WeatherType.Clear) === WeatherType.Thunder ? 1 : 0))
    .fn("is_raining_at", args => {
      const pos = blockPosition(args);
      return isRaining(dimension) && isOpenSky(dimension, pos) && !isSnowBiome(dimension, pos) ? 1 : 0;
    })
    .fn("is_snowing_at", args => {
      const pos = blockPosition(args);
      return isRaining(dimension) && isOpenSky(dimension, pos) && isSnowBiome(dimension, pos) ? 1 : 0;
    })
    .fn("is_chunk_loaded_at", args => (safe(() => dimension.isChunkLoaded(blockPosition(args)), false) ? 1 : 0))
    .fn("set_block", args => {
      const id = withNamespace(asString(args[3]), "minecraft");
      try { dimension.setBlockType(blockPosition(args), id); return 1; }
      catch (e) { console.warn(`[molang] set_block: bloco desconhecido ou posição inválida (${id}): ${e}`); return 0; }
    })
    .fn("is_air", args => (safe(() => dimension.getBlock(blockPosition(args))?.isAir ?? false, false) ? 1 : 0))
    .fn("get_block", args => blockStruct(dimension, blockPosition(args)))
    .fn("spawn_explosion", args => {
      const interaction = args[4] === undefined ? "TNT" : asString(args[4]).toUpperCase();
      safe(() => dimension.createExplosion(position(args), asNumber(args[3]), { breaksBlocks: interaction !== "NONE" }), false);
      return 1;
    })
    .fn("spawn_lightning", args => {
      safe(() => dimension.spawnEntity("minecraft:lightning_bolt", position(args)), undefined);
      return 1;
    })
    .fn("spawn_bedrock_particles", args => {
      const effect = bedrockSoundId(asString(args[0]));
      const pos = position(args, 1);
      const player = playerFromValue(args[4]);
      if (player) safe(() => player.spawnParticle(effect, pos), undefined);
      else safe(() => dimension.spawnParticle(effect, pos), undefined);
      return 1;
    })
    .fn("spawn_pokemon", args => {
      try {
        const entity = spawnWildPokemon(dimension, blockPosition(args), asString(args[3]));
        return entity ? asMostSpecificStruct(entity) : 0;
      }
      catch (e) { console.warn(`[molang] spawn_pokemon falhou: ${e}`); return 0; }
    })
    .fn("spawn_npc", args => {
      if (args[3] === undefined) return 0;
      try {
        const npc = spawnNPC(dimension, position(args), withNamespace(asString(args[3])), { level: argInt(args, 4, 1) });
        return npc ? npc.struct : 0;
      }
      catch (e) { console.warn(`[molang] spawn_npc falhou: ${e}`); return 0; }
    })
    .fn("play_sound_on_server", args => {
      // play_sound_on_server(som, categoria, x, y, z, [jogador], [volume], [tom]); a categoria não existe no Bedrock.
      const sound = bedrockSoundId(asString(args[0]));
      const pos = position(args, 2);
      const player = playerFromValue(args[5]);
      const volume = argNumber(args, 6, 1), pitch = argNumber(args, 7, 1);
      if (player) safe(() => player.playSound(sound, { location: pos, volume, pitch }), undefined);
      else safe(() => dimension.playSound(sound, pos, { volume, pitch }), undefined);
      return 1;
    })
    .fn("get_entities_around", args => {
      const center = position(args);
      const range = asNumber(args[3]);
      // AABB.ofSize(centro, 2·range, ...): cubo de meia-aresta `range`.
      const entities = safe(() => dimension.getEntities({
        location: { x: center.x - range, y: center.y - range, z: center.z - range },
        volume: { x: range * 2, y: range * 2, z: range * 2 },
      }), []);
      return new MoArray(entities.filter(e => safe(() => !!e.getComponent("minecraft:health"), false)).map(asMostSpecificStruct));
    })
    .fn("is_healer_in_use", args => {
      const pos = asBlockPos(args[0]);
      const block = pos ? safe(() => dimension.getBlock(pos), undefined) : undefined;
      // Sem máquina de cura no lugar conta como "em uso" (o Java devolve 1).
      if (!block || block.typeId !== "cobblemon:healing_machine") return 1;
      return safe(() => block.permutation.getState("cobblemon:busy" as never) ? 1 : 0, 1);
    })
    .fn("spawn_loot_table_items", args => {
      // Cobblemon 1.8.0: q.world.spawn_loot_table_items(loot_table_id, x, y, z).
      const id = asString(args[0]);
      const pos = position(args, 1);
      const manager = safe(() => world.getLootTableManager(), undefined);
      const table = manager ? lootTablePaths(id).map(path => safe(() => manager.getLootTable(path), undefined)).find(t => t) : undefined;
      if (!manager || !table) {
        console.warn(`[molang] spawn_loot_table_items: loot table ${id} não encontrada`);
        return new MoArray([]);
      }
      const spawned: MoStruct[] = [];
      const loot = safe(() => manager.generateLootFromTable(table), undefined);
      for (const stack of Array.isArray(loot) ? loot : []) {
        if (!stack || stack.amount <= 0) continue;
        try {
          dimension.spawnItem(stack, pos);
          spawned.push(createItemStackStruct(stack));
        }
        catch (e) { console.warn(`[molang] spawn_loot_table_items: não foi possível soltar ${stack.typeId}: ${e}`); }
      }
      return new MoArray(spawned);
    });
  return struct;
}

function isSnowBiome(dimension: Dimension, pos: Vector3): boolean {
  return safe(() => dimension.getBiome(pos).hasTags(["frozen"]) || dimension.getBiome(pos).hasTags(["cold"]), false);
}
