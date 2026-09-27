/**
 * Ganchos de jogabilidade ligados no carregamento (frente "jogabilidade"):
 *
 * - gamerules `battleInvulnerability` (PlayerMixin.isInvulnerableTo: jogador em batalha não leva dano) e
 *   `mobTargetInBattle` (TargetingConditionsMixin: com a regra desligada, mobs não miram jogadores em batalha). O
 *   Bedrock não deixa um script tirar o alvo de um mob vanilla sem sobrescrever todas as entidades: o port cancela o
 *   dano que um mob (não jogador) causaria no jogador em batalha, que é o efeito prático da regra;
 * - recompensas do Alfa selvagem derrotado (callback `battle_fainted/pokemon_alpha_drops`, scripts/pokemon/AlphaRewards.ts);
 * - `savePokemonToWorld` desligado: selvagens não persistem (PokemonEntity.shouldBeSaved) — ao recarregar um chunk os
 *   selvagens salvos somem;
 * - fome nos itens (scripts/pokemon/Fullness.ts).
 */
import { Entity, Player, world } from "@minecraft/server";
import { getConfig, getGameRule } from "../Config";
import { CobblemonEvents } from "../events/CobblemonEvents";
import { ActorType } from "../battle/BattleActor";
import { dropAlphaRewards } from "./AlphaRewards";
import { installFullnessHooks } from "./Fullness";
import { getItemBehaviour } from "../items/effects";
import { PokemonData } from "../Pokemon";

/** Decide se o dano no jogador é cancelado pelas gamerules. `attackerIsMob` = causado por entidade que não é jogador. */
export function cancelPlayerDamage(inBattle: boolean, attackerIsMob: boolean, rules: { battleInvulnerability: boolean; mobTargetInBattle: boolean }): boolean {
  if (!inBattle) return false;
  if (rules.battleInvulnerability) return true;
  return !rules.mobTargetInBattle && attackerIsMob;
}

/** Selvagem salvo no mundo que deve sumir ao carregar (savePokemonToWorld = false). */
export function shouldDiscardLoadedWild(entity: { isWild: boolean; owned: boolean; persistent: boolean }, savePokemonToWorld: boolean): boolean {
  return !savePokemonToWorld && entity.isWild && !entity.owned && !entity.persistent;
}

let started = false;

/** Liga os ganchos. `inBattle` vem de scripts/battle (injeção evita import circular). */
export function registerGameplayHooks(inBattle: (player: Player) => boolean) {
  if (started) return;
  started = true;

  world.beforeEvents.entityHurt.subscribe(event => {
    const hurt = event.hurtEntity;
    if (!(hurt instanceof Player)) return;
    try {
      const attacker = event.damageSource.damagingEntity;
      const attackerIsMob = !!attacker && !(attacker instanceof Player);
      const rules = { battleInvulnerability: getGameRule("battleInvulnerability"), mobTargetInBattle: getGameRule("mobTargetInBattle") };
      if (!rules.battleInvulnerability && rules.mobTargetInBattle) return;
      if (cancelPlayerDamage(inBattle(hurt), attackerIsMob, rules)) event.cancel = true;
    }
    catch { /* jogador saindo */ }
  });

  CobblemonEvents.on("BATTLE_FAINTED", (_battle, active) => {
    try {
      if (active.actor.type !== ActorType.WILD || !active.entity?.isValid) return;
      const data = active.data;
      if (!data.aspects.includes("alpha")) return;
      dropAlphaRewards({ aspects: data.aspects, level: data.level, types: data.getTypes() }, active.entity.dimension, active.entity.location);
    }
    catch (e) { console.warn(`Recompensas do Alfa: ${e}`); }
  });

  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    try {
      if (getConfig().savePokemonToWorld) return;
      if (!entity.isValid || !entity.typeId.startsWith("cobblemon:")) return;
      if (!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon")) return;
      const discard = shouldDiscardLoadedWild({
        isWild: entity.getProperty("cobblemon:wild") === true,
        owned: entity.getDynamicProperty("owner_name") !== undefined,
        // Pokémon de pasto ou em batalha ficam (isPersistenceRequired).
        persistent: entity.getProperty("cobblemon:in_battle") === true || entity.getDynamicProperty("cobblemon:pasture_owner") !== undefined,
      }, false);
      if (discard) entity.remove();
    }
    catch { /* entidade já saiu */ }
  });

  const wrapped = installFullnessHooks(getItemBehaviour, pokemon => {
    try { return pokemon.tryGetPokemonOut(); }
    catch { return undefined; }
  });
  if (wrapped === 0) console.warn("Fome: nenhum item de comida encontrado para ligar.");
}

/** Para testes/depuração: dados do Pokémon da entidade. */
export function dataOf(entity: Entity): PokemonData | undefined {
  return PokemonData.tryGetFromEntity(entity);
}
