/**
 * Dano fora de batalha por Pokémon (frente motor; PokemonServerDelegate.updateAttributes do Cobblemon 1.8.2).
 *
 * No Java o ATTACK_DAMAGE de cada Pokémon vem do Ataque atual (attackToDamageCurve) e ARMOR/ARMOR_TOUGHNESS da
 * Defesa (defenceToArmourCurve); `playerDamagePokemon = false` deixa o Pokémon invulnerável a jogadores.
 * O `minecraft:attack` do Bedrock tem dano fixo por espécie (o importador usa um Pokémon nível 25, IV 15:
 * tools/importer/entities.ts meleeDamage), mas `world.beforeEvents.entityHurt.damage` é gravável (T17). Aqui:
 * - atacante Pokémon (entityAttack): dano × curva(Ataque atual) / dano fixo da espécie — mantém a escala de
 *   dificuldade que o motor já aplicou;
 * - Pokémon atingido: absorção de armadura com a armadura/tenacidade da Defesa (CombatRules.getDamageAfterAbsorb);
 * - jogador → Pokémon com `playerDamagePokemon` desligado: cancelado.
 * Atributos em cache por entidade (recalcula quando a dynamic property "data" muda).
 */
import { Entity, EntityHurtBeforeEvent, Player, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";

// ---------------------------------------------------------------------------------------------
// Lógica pura (fórmulas do Cobblemon/Minecraft)

/** PokemonServerDelegate.attackToDamageCurve. */
export function attackToDamageCurve(attack: number): number {
  const damage = attack < 10 ? 1 : Math.ceil(Math.sqrt(Math.pow(attack - 10, 0.875)));
  return Math.max(1, damage);
}

/** Dano fixo do `minecraft:attack` gerado (nível 25, IV 15, EV 0, natureza neutra) — igual a entities.ts. */
export function speciesMeleeDamage(baseAttack: number): number {
  const attack = Math.floor(((2 * baseAttack + 15) * 25) / 100) + 5;
  return attackToDamageCurve(attack);
}

/** PokemonServerDelegate.defenceToArmourCurve → [armadura, tenacidade]. */
export function defenceToArmour(defence: number): [number, number] {
  const armour = defence < 200 ? 0 : Math.min(30, Math.round((defence - 200) / 10));
  const toughness = defence < 300 ? 0 : Math.min(20, Math.round((defence - 300) / 7.5));
  return [armour, toughness];
}

/** CombatRules.getDamageAfterAbsorb (1.21). */
export function damageAfterArmour(damage: number, armour: number, toughness: number): number {
  if (armour <= 0) return damage;
  const f = 2 + toughness / 4;
  const g = Math.min(20, Math.max(armour * 0.2, armour - damage / f));
  return damage * (1 - g / 25);
}

/** Dano do golpe de um Pokémon: escala o dano que o motor calculou (já com dificuldade). */
export function scaledPokemonDamage(engineDamage: number, attack: number, baseAttack: number): number {
  const base = speciesMeleeDamage(baseAttack);
  return base > 0 ? engineDamage * (attackToDamageCurve(attack) / base) : engineDamage;
}

/** Causas que a armadura do Java reduz (as que não estão em BYPASSES_ARMOR). */
export const ARMOUR_CAUSES = new Set(["entityAttack", "projectile", "entityExplosion", "blockExplosion", "anvil", "fallingBlock", "thorns", "contact", "maceSmash"]);

// ---------------------------------------------------------------------------------------------
// Runtime

interface CombatStats { raw: string; attack: number; defence: number; baseAttack: number }
const cache = new Map<string, CombatStats>();

function isPokemonEntity(entity: Entity | undefined): entity is Entity {
  try { return !!entity && entity.typeId.startsWith("cobblemon:") && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon"); }
  catch { return false; }
}

/** Ataque/Defesa atuais e Ataque base da espécie (só leitura: pode rodar no before-event). */
export function combatStatsOf(entity: Entity): CombatStats | undefined {
  let raw: unknown;
  try { raw = entity.getDynamicProperty("data"); }
  catch { return undefined; }
  if (typeof raw !== "string") return undefined;
  const hit = cache.get(entity.id);
  if (hit && hit.raw === raw) return hit;
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data) return undefined;
  try {
    const stats = data.getCurrentStats();
    const baseAttack = Number(data.getSpeciesData().baseStats?.attack ?? data.getBaseStats().attack ?? 50);
    const out: CombatStats = { raw, attack: stats.atk, defence: stats.def, baseAttack };
    cache.set(entity.id, out);
    if (cache.size > 2048) cache.delete(cache.keys().next().value!);
    return out;
  }
  catch { return undefined; }
}

export function onEntityHurtBefore(event: EntityHurtBeforeEvent) {
  const { hurtEntity, damageSource } = event;
  const attacker = damageSource.damagingEntity;
  const cause = String(damageSource.cause);
  const hurtIsPokemon = isPokemonEntity(hurtEntity);
  if (hurtIsPokemon && attacker instanceof Player && !getConfig().playerDamagePokemon) {
    event.cancel = true;
    return;
  }
  let damage = event.damage;
  if (cause === "entityAttack" && isPokemonEntity(attacker)) {
    const stats = combatStatsOf(attacker);
    if (stats) damage = scaledPokemonDamage(damage, stats.attack, stats.baseAttack);
  }
  if (hurtIsPokemon && ARMOUR_CAUSES.has(cause)) {
    const stats = combatStatsOf(hurtEntity);
    if (stats) {
      const [armour, toughness] = defenceToArmour(stats.defence);
      damage = damageAfterArmour(damage, armour, toughness);
    }
  }
  if (damage !== event.damage) event.damage = Math.max(0, damage);
}

export function forgetCombatStats(entityId: string) {
  cache.delete(entityId);
}

let started = false;

export function startPokemonDamage() {
  if (started) return;
  started = true;
  world.beforeEvents.entityHurt.subscribe(event => {
    try { onEntityHurtBefore(event); }
    catch { /* entidade inválida no meio do golpe */ }
  });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => forgetCombatStats(removedEntityId));
}
