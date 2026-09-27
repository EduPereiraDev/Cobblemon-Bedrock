/**
 * Frente ui-cliente: arremesso da Poké Ball quando o jogador usa a bola MIRANDO num Pokémon.
 *
 * No Bedrock, usar um item com a mira numa entidade dispara `playerInteractWithEntity` em vez de `itemUse`, e o
 * `minecraft:throwable` nativo não lança: a bola só saía mirando um pouco acima do Pokémon. No Java, o clique direito
 * num Pokémon com a bola passa pelo `PokemonEntity.mobInteract` (nada ali usa Poké Ball) e cai no `PokeBallItem.use`,
 * que arremessa. Aqui a interação vira o mesmo arremesso: o projétil `cobblemon:<bola>` (o mesmo que o throwable nativo
 * cria, então o resto da captura em `catching/index.ts` não muda), com a potência do `minecraft:projectile` da bola.
 *
 * Exceções (como no Java): agachado (o Java abre a roda de interação; no port, dar item/menu), clone de batalha
 * (`mobInteract` devolve FAIL) e a exibição de NPC com modelo de Pokémon (o clique é do NPC).
 */
import { Entity, GameMode, Player, Vector3 } from "@minecraft/server";
import { PokeBall, getPokeBall, projectilePower } from "./PokeBalls";

/** Bola do Cobblemon pelo id do item (`cobblemon:great_ball`), ou undefined se o item não é Poké Ball. */
export function pokeBallFromItem(typeId: string | undefined): PokeBall | undefined {
  if (!typeId || !typeId.startsWith("cobblemon:")) return undefined;
  return getPokeBall(typeId);
}

export interface BallInteractContext {
  /** Jogador agachado (Java: roda de interação em vez do arremesso). */
  sneaking: boolean;
  /** O alvo é um Pokémon (família `pokemon` do Cobblemon). */
  isPokemon: boolean;
  /** Clone de batalha (InteractPokemonHandler/mobInteract ignoram). */
  isBattleClone?: boolean;
  /** Exibição de NPC com modelo de Pokémon (o clique vai para o NPC). */
  isNpcModel?: boolean;
}

/** Usar a bola mirando esta entidade deve arremessar? (pura, para teste) */
export function shouldThrowOnEntityInteract(itemTypeId: string | undefined, context: BallInteractContext): boolean {
  if (!pokeBallFromItem(itemTypeId)) return false;
  if (context.sneaking || !context.isPokemon) return false;
  if (context.isBattleClone || context.isNpcModel) return false;
  return true;
}

/** Velocidade do arremesso: direção do olhar (normalizada) × potência, como o throwable nativo (`power` do projétil). */
export function throwVelocity(direction: Vector3, power: number): Vector3 {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return { x: (direction.x / length) * power, y: (direction.y / length) * power, z: (direction.z / length) * power };
}

/**
 * Ponto de saída: um pouco à frente dos olhos (o Java põe a bola 1 bloco à frente; aqui 0,6 para ela não nascer dentro
 * de um Pokémon colado no jogador, o que faria o projétil não registrar o acerto).
 */
export function throwOrigin(head: Vector3, direction: Vector3): Vector3 {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const step = 0.6 / length;
  return { x: head.x + direction.x * step, y: head.y - 0.1 + direction.y * step, z: head.z + direction.z * step };
}

/**
 * Arremessa a bola que está no slot selecionado (consome 1 fora do criativo). Retorna false se o slot não tem mais a
 * mesma bola ou se o projétil não pôde nascer. Precisa rodar fora do modo restrito (ex.: `system.run`).
 */
export function throwPokeBall(player: Player, itemTypeId: string): boolean {
  const ball = pokeBallFromItem(itemTypeId);
  if (!ball) return false;
  const slot = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const stack = slot?.getItem();
  if (!slot || stack?.typeId !== itemTypeId) return false;
  const direction = player.getViewDirection();
  let projectile: Entity;
  try { projectile = player.dimension.spawnEntity(ball.id, throwOrigin(player.getHeadLocation(), direction)); }
  catch (e) {
    console.warn(`Arremesso da ${ball.id}: ${e}`);
    return false;
  }
  // Dono antes do primeiro tick de voo (o entitySpawn de catching/index.ts também grava o player_id).
  try { projectile.setDynamicProperty("player_id", player.id); } catch { }
  const velocity = throwVelocity(direction, projectilePower(ball));
  const component = projectile.getComponent("minecraft:projectile");
  try {
    if (component) {
      component.owner = player;
      component.shoot(velocity);
    }
    else projectile.applyImpulse(velocity);
  }
  catch (e) { console.warn(`Arremesso da ${ball.id}: ${e}`); }
  if (player.getGameMode() !== GameMode.Creative) {
    if (stack.amount > 1) slot.amount = stack.amount - 1;
    else slot.setItem(undefined);
  }
  return true;
}
