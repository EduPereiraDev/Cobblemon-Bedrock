/**
 * Interações com o Pokémon pelo item na mão (Cobblemon 1.8.2):
 * - data/cobblemon/pokemon_interactions (PokemonInteractions.findInteraction + attemptItemInteraction):
 *   só o dono, sem agachar, com o item exigido na mão principal; efeitos shrink_item, drop_item,
 *   give_item, play_sound; cooldown por "grouping" guardado no Pokémon (Pokemon.interactionCooldowns).
 * - tosquia com tesoura (PokemonEntity.shear/readyForShearing): dono ou selvagem, aspect "sheared";
 *   a lã volta quando ele come grama (EatGrassTask → evento cobblemon:ate_grass da entidade).
 * - tigela em Miltank "mooshtank" → ensopado de cogumelo.
 * - efeito `script` (só o Furfrou: tesoura com corante vestido → corte `poodle_trim`).
 */
import { evaluateChance } from "../evolution/requirements/GenericRequirements";
import { Entity, GameMode, ItemStack, Player, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { getEntityInfo, getInteractionSets, speciesIdOfType } from "./EntityData";
import type { Interaction, InteractionEffect, InteractionSet } from "./EntityData";
import { playParticleSounds } from "../visual/ParticleSounds";

// ---------------------------------------------------------------------------------------------
// Lógica pura (testada em tests/entidades.test.ts)

/** O que a tabela de interações precisa saber do Pokémon. */
export interface InteractionTarget {
  species: string;
  /** "m" | "f" | "" (PokemonData.gender). */
  gender: string;
  /** Nome da forma ativa ("" = padrão). */
  formName: string;
  aspects: readonly string[];
}

/** grouping → tick absoluto (world.getAbsoluteTime) em que o cooldown acaba. */
export type InteractionCooldowns = Record<string, number>;

export function isOnCooldown(cooldowns: InteractionCooldowns | undefined, grouping: string, now: number): boolean {
  return (cooldowns?.[grouping] ?? 0) > now;
}

/** Pokemon.interactionCooldowns.put(grouping, cooldown): 0 = sem cooldown. Remove os vencidos. */
export function startCooldown(cooldowns: InteractionCooldowns, grouping: string, ticks: number, now: number): InteractionCooldowns {
  for (const [key, until] of Object.entries(cooldowns)) if (until <= now) delete cooldowns[key];
  if (ticks > 0) cooldowns[grouping] = now + ticks;
  return cooldowns;
}

/** Requisito `properties` do conjunto ("gogoat gender=female", "rotom form=frost"). */
export function matchesSet(set: InteractionSet, target: InteractionTarget): boolean {
  return set.species === target.species && matchesProperties(set.properties, target);
}

/** Propriedades do PokemonProperties usadas nos dados: gender, form; o resto vira aspect. */
export function matchesProperties(properties: Record<string, string> | undefined, target: InteractionTarget): boolean {
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (key === "gender") {
      const g = value === "female" ? "f" : value === "male" ? "m" : "";
      if (target.gender !== g) return false;
    }
    else if (key === "form") {
      if (target.formName.toLowerCase().replace(/[^a-z0-9]/g, "") !== value.replace(/[^a-z0-9]/g, "")) return false;
    }
    else if (!target.aspects.includes(value) && !target.aspects.includes(`${key}-${value}`)) return false;
  }
  return true;
}

/**
 * Primeira interação cujo conjunto e requisitos valem e que não está em cooldown
 * (os conjuntos já vêm com os mais específicos primeiro, como no Cobblemon).
 */
export function findInteraction(
  sets: readonly InteractionSet[], target: InteractionTarget, heldItem: string | undefined,
  cooldowns: InteractionCooldowns | undefined, now: number,
): Interaction | undefined {
  if (!heldItem) return undefined;
  for (const set of sets) {
    if (!matchesSet(set, target)) continue;
    for (const interaction of set.interactions) {
      if (interaction.items.length && !interaction.items.includes(heldItem)) continue;
      if (!matchesProperties(interaction.properties, target)) continue;
      if (isOnCooldown(cooldowns, interaction.grouping, now)) continue;
      // Requisito `chance` (ChanceRequirement; frente dados-ui): sorteado a cada tentativa, como no Cobblemon.
      const chance = (interaction as { chance?: string }).chance;
      if (chance !== undefined && !evaluateChance(chance)) continue;
      return interaction;
    }
  }
  return undefined;
}

/** Quantidade sorteada de um drop_item/give_item ("1-2"). */
export function rollAmount(effect: { min: number; max: number }, random = Math.random): number {
  return effect.min + Math.floor(random() * (effect.max - effect.min + 1));
}

/**
 * Action effect `cobblemon:furfrou_trim` (script da interação da tesoura no Furfrou): o corante vestido como
 * cosmético escolhe o corte (`poodle_trim=<corte>` → aspect `<corte>-trim`) e o cosmético é consumido
 * (`remove_cosmetic_item`, mesmo sem corante).
 */
export const FURFROU_TRIMS: Readonly<Record<string, string>> = {
  "minecraft:magenta_dye": "matron", "minecraft:pink_dye": "heart", "minecraft:lime_dye": "dandy",
  "minecraft:blue_dye": "pharaoh", "minecraft:cyan_dye": "la_reine", "minecraft:light_blue_dye": "star",
  "minecraft:red_dye": "kabuki", "minecraft:orange_dye": "diamond", "minecraft:yellow_dye": "debutante",
  "minecraft:brown_dye": "cinnamon", "minecraft:light_gray_dye": "crusader", "minecraft:purple_dye": "lavender",
  "minecraft:green_dye": "matcha", "minecraft:black_dye": "mourner", "minecraft:gray_dye": "rocker",
  "minecraft:white_dye": "natural",
};

/** O que o corte precisa do Pokémon (subconjunto de PokemonData). */
export interface TrimTarget {
  aspects: string[];
  cosmeticItem?: string;
  setCosmeticItem(item?: string): string | undefined;
}

/** Aplica o corte do corante vestido e tira o cosmético. @returns o corte aplicado, se houve. */
export function applyFurfrouTrim(pokemon: TrimTarget): string | undefined {
  const trim = pokemon.cosmeticItem ? FURFROU_TRIMS[pokemon.cosmeticItem] : undefined;
  if (trim) {
    pokemon.aspects = pokemon.aspects.filter(aspect => !aspect.endsWith("-trim"));
    pokemon.aspects.push(`${trim}-trim`);
  }
  pokemon.setCosmeticItem(undefined);
  return trim;
}

/** Scripts de interação conhecidos (só o Furfrou usa `script` no 1.8.2). */
export function interactionScriptAction(script: string): "furfrou_trim" | undefined {
  return /run_action_effect\(\s*'cobblemon:furfrou_trim'\s*\)/.test(script) ? "furfrou_trim" : undefined;
}

/** PokemonEntity.shear: lã = 1 + (nextInt(3) + 1) itens, da cor do aspect "color-*" (padrão branca). */
export function shearDrops(aspects: readonly string[], random = Math.random): { item: string; amount: number } {
  const color = aspects.find(a => a.startsWith("color-"))?.slice(6) || "white";
  return { item: `minecraft:${color}_wool`, amount: Math.floor(random() * 3) + 2 };
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** Cooldowns guardados no JSON do Pokémon (campo extra, preservado por PokemonData.getFromJson). */
export function getCooldowns(data: PokemonData): InteractionCooldowns {
  const holder = data as unknown as { interactionCooldowns?: InteractionCooldowns };
  if (!holder.interactionCooldowns || typeof holder.interactionCooldowns !== "object") holder.interactionCooldowns = {};
  return holder.interactionCooldowns;
}

export function targetOf(data: PokemonData): InteractionTarget {
  return {
    species: speciesIdOfType(data.getEntityId()),
    gender: data.gender ?? "",
    formName: data.getFormData()?.name ?? "",
    aspects: data.aspects ?? [],
  };
}

/** Relógio dos cooldowns: tempo absoluto do mundo (o Cobblemon desconta só com o dono online; aqui corre sempre). */
function now(): number {
  try {
    return world.getAbsoluteTime();
  }
  catch {
    return 0;
  }
}

function isCreative(player: Player): boolean {
  try {
    return player.getGameMode() === GameMode.Creative;
  }
  catch {
    return false;
  }
}

/** ShrinkItemEffect: item com durabilidade leva dano; senão consome `amount`. Criativo não gasta. */
function shrinkHeldItem(player: Player, amount: number) {
  if (isCreative(player)) return;
  const slot = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const item = slot?.getItem();
  if (!slot || !item) return;
  const durability = item.getComponent("minecraft:durability");
  if (durability) {
    const damage = durability.damage + amount;
    if (damage >= durability.maxDurability) {
      slot.setItem(undefined);
      player.dimension.playSound("random.break", player.location);
    }
    else {
      durability.damage = damage;
      slot.setItem(item);
    }
    return;
  }
  if (item.amount <= amount) slot.setItem(undefined);
  else slot.amount = item.amount - amount;
}

/** Dá o item ao jogador; o que não couber cai no chão (giveOrDropItemStack). */
function giveOrDrop(player: Player, stack: ItemStack) {
  const rest = player.getComponent("minecraft:inventory")?.container?.addItem(stack);
  if (rest) player.dimension.spawnItem(rest, player.location);
}

function makeStack(item: string, amount: number): ItemStack | undefined {
  try {
    return new ItemStack(item, Math.max(1, Math.min(64, amount)));
  }
  catch {
    // Item ainda não existe no pack (ex.: cobblemon:shed_shell sem definição).
    console.warn(`[entidades] item de interação inexistente: ${item}`);
    return undefined;
  }
}

/** Altura dos olhos − 0.3 (DropItemEffect). */
function dropLocation(pokemon: Entity) {
  const height = getEntityInfo(pokemon.typeId)?.sizes[0];
  const eye = height ? height.height * height.scale * 0.85 : 0.8;
  return { x: pokemon.location.x, y: pokemon.location.y + Math.max(0.2, eye - 0.3), z: pokemon.location.z };
}

/**
 * Partícula do corte por corante (timeline de `action_effects/misc/furfrou_trim.json`:
 * `q.pokemon.spawn_bedrock_particles('cobblemon:poodle_hair_<cor>', 'middle')`). O lime_dye usa a verde, como no
 * Cobblemon (a `poodle_hair_lime` existe mas não é usada). Frente visual-final, #103.
 */
export const FURFROU_TRIM_PARTICLES: Readonly<Record<string, string>> = {
  "minecraft:magenta_dye": "cobblemon:poodle_hair_magenta", "minecraft:pink_dye": "cobblemon:poodle_hair_pink",
  "minecraft:lime_dye": "cobblemon:poodle_hair_green", "minecraft:blue_dye": "cobblemon:poodle_hair_blue",
  "minecraft:cyan_dye": "cobblemon:poodle_hair_cyan", "minecraft:light_blue_dye": "cobblemon:poodle_hair_light_blue",
  "minecraft:red_dye": "cobblemon:poodle_hair_red", "minecraft:orange_dye": "cobblemon:poodle_hair_orange",
  "minecraft:yellow_dye": "cobblemon:poodle_hair_yellow", "minecraft:brown_dye": "cobblemon:poodle_hair_brown",
  "minecraft:light_gray_dye": "cobblemon:poodle_hair_light_gray", "minecraft:purple_dye": "cobblemon:poodle_hair_purple",
  "minecraft:green_dye": "cobblemon:poodle_hair_green", "minecraft:black_dye": "cobblemon:poodle_hair_black",
  "minecraft:gray_dye": "cobblemon:poodle_hair_gray", "minecraft:white_dye": "cobblemon:poodle_hair_white",
};

/** Instantes (ticks) da timeline em que a partícula sai: 0 s, 0,2 s e 0,7 s (junto com o corte). */
export const FURFROU_TRIM_PARTICLE_TICKS = [0, 4, 14];

/**
 * Partículas do corte no locator `middle` (meio do hitbox). Sem corante vestido, nenhuma (as expressões da timeline
 * só disparam com `cosmetic_item.is_of(<corante>)`). O som de tesoura vem dos eventos da própria partícula, tocados
 * pelo script (scripts/visual/ParticleSounds.ts: o Bedrock não aceita esse som no JSON da partícula).
 */
function trimParticles(pokemon: Entity, dye: string | undefined) {
  const particle = dye ? FURFROU_TRIM_PARTICLES[dye] : undefined;
  if (!particle) return;
  const size = getEntityInfo(pokemon.typeId)?.sizes[0];
  const middle = size ? (size.height * size.scale) / 2 : 0.5;
  for (const delay of FURFROU_TRIM_PARTICLE_TICKS) {
    const spawn = () => {
      if (!pokemon.isValid) return;
      const { x, y, z } = pokemon.location;
      try {
        pokemon.dimension.spawnParticle(particle, { x, y: y + middle, z });
        // Frente cliente-log: o som de tesoura dos eventos da partícula toca pelo script.
        playParticleSounds(pokemon.dimension, particle, { x, y: y + middle, z });
      }
      catch { }
    };
    if (delay <= 0) spawn();
    else system.runTimeout(spawn, delay);
  }
}

function applyEffect(effect: InteractionEffect, pokemon: Entity, player: Player, data: PokemonData) {
  switch (effect.type) {
    case "shrink_item":
      shrinkHeldItem(player, effect.amount);
      break;
    case "drop_item": {
      const stack = makeStack(effect.item, rollAmount(effect));
      if (stack) pokemon.dimension.spawnItem(stack, dropLocation(pokemon));
      break;
    }
    case "give_item": {
      const stack = makeStack(effect.item, rollAmount(effect));
      if (stack) giveOrDrop(player, stack);
      break;
    }
    case "play_sound":
      try {
        pokemon.dimension.playSound(effect.sound, pokemon.location);
      }
      catch { }
      break;
    case "script":
      if (interactionScriptAction(effect.script) === "furfrou_trim") {
        trimParticles(pokemon, data.cosmeticItem);
        applyFurfrouTrim(data);
      }
      else console.warn(`[interações] script sem suporte: ${effect.script}`);
      break;
  }
}

/** Grava os dados do Pokémon na entidade e no time do dono. */
function save(data: PokemonData, entity: Entity, owner?: Player) {
  data.applyToCobblemon(entity);
  if (owner) data.tryUpdatePokemonInTeam(owner);
}

/** Interação de pokemon_interactions. true = consumiu o clique. */
export function tryDataInteraction(player: Player, pokemon: Entity, data: PokemonData, heldItem: ItemStack | undefined): boolean {
  const cooldowns = getCooldowns(data);
  const time = now();
  const interaction = findInteraction(getInteractionSets(), targetOf(data), heldItem?.typeId, cooldowns, time);
  if (!interaction) return false;
  for (const effect of interaction.effects) applyEffect(effect, pokemon, player, data);
  startCooldown(cooldowns, interaction.grouping, interaction.cooldown, time);
  save(data, pokemon, player);
  return true;
}

/** Tosquia (Wooloo, Dubwool, Mareep). */
export function tryShear(player: Player, pokemon: Entity, data: PokemonData, heldItem: ItemStack | undefined): boolean {
  if (heldItem?.typeId !== "minecraft:shears") return false;
  if (!getEntityInfo(pokemon.typeId)?.shearable) return false;
  if (data.aspects.includes("sheared") || data.currentHealth <= 0) return false;
  if (pokemon.getProperty("cobblemon:busy") === true || pokemon.getProperty("cobblemon:in_battle") === true) return false;
  const drop = shearDrops(data.aspects);
  const stack = makeStack(drop.item, drop.amount);
  if (stack) pokemon.dimension.spawnItem(stack, dropLocation(pokemon));
  pokemon.dimension.playSound("mob.sheep.shear", pokemon.location);
  data.aspects.push("sheared");
  shrinkHeldItem(player, 1);
  const owner = data.tryGetOwner(pokemon);
  save(data, pokemon, owner);
  return true;
}

/** Tigela numa Miltank "mooshtank" (sem o ensopado suspeito, que depende da flor dada antes). */
export function tryMooshtankBowl(player: Player, pokemon: Entity, data: PokemonData, heldItem: ItemStack | undefined): boolean {
  if (heldItem?.typeId !== "minecraft:bowl" || !data.aspects.some(a => a.includes("mooshtank"))) return false;
  pokemon.dimension.playSound("mob.mooshroom.suspicious_milk", pokemon.location);
  shrinkHeldItem(player, 1);
  const stew = makeStack("minecraft:mushroom_stew", 1);
  if (stew) giveOrDrop(player, stew);
  return true;
}

/** EatGrassTask: comer grama faz a lã voltar. */
export function onAteGrass(pokemon: Entity) {
  const data = PokemonData.tryGetFromEntity(pokemon);
  if (!data || !data.aspects.includes("sheared")) return;
  data.aspects = data.aspects.filter(a => a !== "sheared");
  save(data, pokemon, data.tryGetOwner(pokemon));
}
