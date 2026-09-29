/**
 * Comportamentos de espécie do Cobblemon 1.8.2 que precisam de script (os de dados estão no BP gerado).
 *
 * pokemon_bee (Combee): fora do time, de dia e sem chuva, voa até uma flor (grupo `cobblemon:bee_look_for_flower`,
 * move_to_block com as flores da abelha vanilla), fica 20 s polinizando (PollinateFlowerTask: 400 ticks) e ganha
 * néctar (aspect `has_nectar`: partículas de néctar pingando, AspectParticleMap); depois procura folhas de
 * saccharine (e, se selvagem, colmeias) no grupo `cobblemon:bee_return`, fica 12,5 s (250 ticks) e deposita: folha
 * de saccharine sobe um estágio de mel (PlaceHoneyInSaccLeavesTask), colmeia/ninho sobe `honey_level`
 * (PlaceHoneyInHiveTask). Espera 200 ticks (PATH_TO_FLOWER_COOLDOWN) e recomeça. À noite ou na chuva fica parado.
 *
 * pokemon_fox (Vulpix): andar até itens e colher sweet berries são objetivos vanilla no BP (pickup_items/raid_garden);
 * a coleta é daqui (`beforeEvents.entityItemPickup`): o Bedrock guardaria o item no inventário de 1 espaço (o do item
 * segurado) e ele sumia. Pega 1 item com a boca vazia (mão principal, desenhada no locator `item`); comida é comida
 * depois de 28 ticks e cura 2 (fox_food: berries) ou 1 (outras comidas), como apply_fox_properties; o resto fica
 * na boca (cai ao morrer). Neve fofa e sweet berry bush estão no BP (importador).
 *
 * pokemon_gets_mad_at_thrower: nenhuma espécie do 1.8.2 usa; `onHitByPokeball` deixa o gancho pronto (só para
 * dados de datapack que a importação venha a ler).
 */
import { Block, Entity, Player, system, world } from "@minecraft/server";
import { BEE_SPECIES, MAD_AT_THROWER_SPECIES, PICKUP_SPECIES } from "../../generated/scripts/mundoDetalhes";
import { ITEMS } from "../../generated/scripts/items";
import { speciesIdOfType } from "./EntityData";
import { getWeather } from "../utils/World";
import { WeatherType } from "@minecraft/server";

const BEES = new Set(BEE_SPECIES);
const MAD = new Set(MAD_AT_THROWER_SPECIES);

export const BEE_COOLDOWN_TICKS = 200;
export const HAS_NECTAR_ASPECT = "has_nectar";

type BeeState = "idle" | "seek" | "nectar" | "cooldown";

interface BeeMemory {
  state: BeeState;
  until?: number;
  /** Estado cujos grupos de componentes já foram aplicados nesta sessão. */
  applied?: BeeState;
}

const bees = new Map<string, BeeMemory>();

export function isBeeSpecies(species: string): boolean {
  return BEES.has(species);
}

/** Dia sem chuva (Overworld) = pode polinizar; nas outras dimensões sempre pode. */
export function canPollinate(dimensionId: string, timeOfDay: number, raining: boolean): boolean {
  if (dimensionId !== "minecraft:overworld") return true;
  const night = timeOfDay >= 13000 && timeOfDay <= 23000;
  return !night && !raining;
}

/** Próximo estado da abelha a cada segundo. */
export function nextBeeState(memory: BeeMemory, canWork: boolean, now: number): BeeState {
  if (!canWork) return memory.state === "nectar" ? "nectar" : "idle";
  if (memory.state === "cooldown") return memory.until !== undefined && now < memory.until ? "cooldown" : "seek";
  if (memory.state === "idle") return "seek";
  return memory.state;
}

function isRaining(): boolean {
  try { return getWeather(world.getDimension("minecraft:overworld")) !== WeatherType.Clear; }
  catch { return false; }
}

function trigger(entity: Entity, event: string) {
  try { entity.triggerEvent(event); }
  catch { /* evento ausente (espécie sem o behaviour) */ }
}

function setNectar(entity: Entity, has: boolean) {
  const aspects = entity.getDynamicProperty("cobblemon:bee_nectar");
  if ((aspects === true) === has) return;
  entity.setDynamicProperty("cobblemon:bee_nectar", has || undefined);
}

function tickBee(entity: Entity) {
  const busy = entity.getProperty("cobblemon:wild") !== true || entity.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:sleeping") === true || entity.getProperty("cobblemon:busy") === true;
  let memory = bees.get(entity.id);
  if (!memory) {
    memory = { state: entity.getDynamicProperty("cobblemon:bee_nectar") === true ? "nectar" : "idle" };
    bees.set(entity.id, memory);
  }
  if (busy) {
    // Os grupos da abelha saem junto com a IA (batalha, sono, dono); ao voltar, são aplicados de novo.
    if (memory.applied !== undefined && entity.getProperty("cobblemon:wild") !== true) trigger(entity, "cobblemon:bee_idle");
    memory.applied = undefined;
    if (memory.state === "seek") memory.state = "idle";
    return;
  }
  const now = system.currentTick;
  const next = nextBeeState(memory, canPollinate(entity.dimension.id, world.getTimeOfDay(), isRaining()), now);
  memory.state = next;
  if (next !== "cooldown") memory.until = undefined;
  if (memory.applied !== next) {
    if (next === "seek") trigger(entity, "cobblemon:bee_seek");
    else if (next === "nectar") trigger(entity, "cobblemon:bee_has_nectar");
    else trigger(entity, "cobblemon:bee_idle");
    memory.applied = next;
  }
  if (memory.state === "nectar") {
    try { entity.dimension.spawnParticle("minecraft:nectar_drip_particle", { x: entity.location.x, y: entity.location.y + 0.3, z: entity.location.z }); }
    catch { /* partícula ausente */ }
  }
}

/** Bloco de depósito mais perto (até 2 blocos): folhas de saccharine ou, se selvagem, colmeia/ninho. */
function depositTarget(entity: Entity): Block | undefined {
  const base = entity.location;
  let best: Block | undefined;
  let bestDist = Infinity;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    let block: Block | undefined;
    try { block = entity.dimension.getBlock({ x: Math.floor(base.x) + dx, y: Math.floor(base.y) + dy, z: Math.floor(base.z) + dz }); }
    catch { continue; }
    if (!block) continue;
    const ok = block.typeId === "cobblemon:saccharine_leaves" || block.typeId === "minecraft:beehive" || block.typeId === "minecraft:bee_nest";
    const d = dx * dx + dy * dy + dz * dz;
    if (ok && d < bestDist) {
      best = block;
      bestDist = d;
    }
  }
  return best;
}

/** Deposita o néctar: estágio de mel da folha de saccharine (0..2) ou honey_level da colmeia (0..5). */
export function depositHoney(block: Block): boolean {
  try {
    if (block.typeId === "cobblemon:saccharine_leaves") {
      const age = Number(block.permutation.getState("cobblemon:age" as never) ?? 0);
      if (age >= 2) return false;
      block.setPermutation(block.permutation.withState("cobblemon:age" as never, (age + 1) as never));
      block.dimension.playSound("block.beehive.drip", block.location);
      return true;
    }
    const level = Number(block.permutation.getState("honey_level" as never) ?? 0);
    if (level >= 5) return false;
    block.setPermutation(block.permutation.withState("honey_level" as never, (level + 1) as never));
    block.dimension.playSound("block.beehive.enter", block.location);
    return true;
  }
  catch {
    return false;
  }
}

function onBeeEvent(entity: Entity, event: string) {
  const memory = bees.get(entity.id) ?? { state: "idle" as BeeState };
  bees.set(entity.id, memory);
  if (event === "cobblemon:bee_collected_nectar") {
    memory.state = "nectar";
    memory.applied = "nectar";
    setNectar(entity, true);
  }
  else if (event === "cobblemon:bee_deposit") {
    const target = depositTarget(entity);
    if (target && depositHoney(target)) {
      memory.state = "cooldown";
      memory.until = system.currentTick + BEE_COOLDOWN_TICKS;
      memory.applied = "cooldown";
      setNectar(entity, false);
      trigger(entity, "cobblemon:bee_idle");
    }
    // Folha cheia/colmeia cheia: continua com néctar e procura outro lugar.
    else trigger(entity, "cobblemon:bee_has_nectar");
  }
}

export function tickSpeciesBehaviours(entity: Entity, _data: unknown) {
  if (BEES.has(speciesIdOfType(entity.typeId))) tickBee(entity);
}

export function forgetSpeciesBehaviours(entityId: string) {
  bees.delete(entityId);
}

/**
 * pokemon_gets_mad_at_thrower (get_mad_at_thrower.molang): fica bravo com quem jogou a bola por 30 s. Sem espécie no
 * 1.8.2; quando houver, o Pokémon revida como se tivesse sido atacado (hurt_by_target do grupo selvagem).
 */
export function onHitByPokeball(pokemon: Entity, thrower: Player | undefined): boolean {
  if (!thrower || !MAD.has(speciesIdOfType(pokemon.typeId))) return false;
  try {
    pokemon.applyDamage(0.01, { cause: "entityAttack" as never, damagingEntity: thrower });
    return true;
  }
  catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Raposa: pegar e comer

const PICKUP = new Set(PICKUP_SPECIES);
/** Item na boca de cada Pokémon (a mão principal de mob não é legível pela API estável). */
export const MOUTH_PROPERTY = "cobblemon:mouth_item";
export const EAT_DELAY_TICKS = 28;

/** Cura ao comer o que carrega (apply_fox_properties: fox_food cura 2, comida comum 1, o resto não é comido). */
export function foxFoodHeal(itemId: string): number {
  if (itemId === "minecraft:sweet_berries" || itemId === "minecraft:glow_berries") return 2;
  const data = ITEMS[itemId.replace(/^cobblemon:/, "")];
  if (itemId.startsWith("cobblemon:") && data?.category === "berry") return 2;
  if (data?.food || data?.category === "food") return 1;
  return VANILLA_FOOD.test(itemId) ? 1 : 0;
}

const VANILLA_FOOD = /^minecraft:(apple|golden_apple|enchanted_golden_apple|bread|cookie|melon_slice|carrot|golden_carrot|potato|baked_potato|beetroot|beetroot_soup|mushroom_stew|rabbit_stew|suspicious_stew|pumpkin_pie|cake|(cooked_)?(beef|porkchop|chicken|mutton|rabbit|cod|salmon)|tropical_fish|pufferfish|dried_kelp|honey_bottle|chorus_fruit|rotten_flesh|spider_eye|poisonous_potato)$/;

function mouthItem(entity: Entity): string | undefined {
  const v = entity.getDynamicProperty(MOUTH_PROPERTY);
  return typeof v === "string" && v ? v : undefined;
}

function setMouth(entity: Entity, itemId: string | undefined) {
  entity.runCommand(itemId ? `replaceitem entity @s slot.weapon.mainhand 0 ${itemId} 1` : "replaceitem entity @s slot.weapon.mainhand 0 air");
  entity.setDynamicProperty(MOUTH_PROPERTY, itemId);
}

/** Itens que guardam conteúdo/dados próprios: a boca só guarda o id, então pegá-los apagaria esses dados. */
const NOT_PLAIN_ITEM = /^minecraft:(.*shulker_box|.*bundle|potion|splash_potion|lingering_potion|tipped_arrow|written_book|writable_book|filled_map|firework_rocket|firework_star)$/;

/** Forma mínima de pilha usada pelo filtro (ItemStack do jogo ou objeto de teste). */
export interface PlainStackProbe {
  typeId: string;
  nameTag?: string;
  getLore?(): unknown[];
  getDynamicPropertyIds?(): string[];
  getComponent?(id: string): unknown;
}

/**
 * Só pilhas "comuns" vão para a boca: sem nome, lore, propriedades dinâmicas, encantamentos ou desgaste, e fora
 * dos itens com conteúdo. A boca guarda apenas o id do item, então qualquer dado extra seria perdido.
 */
export function isPlainStack(stack: PlainStackProbe): boolean {
  if (NOT_PLAIN_ITEM.test(stack.typeId)) return false;
  if (stack.nameTag) return false;
  if ((stack.getLore?.() ?? []).length > 0) return false;
  if ((stack.getDynamicPropertyIds?.() ?? []).length > 0) return false;
  const enchantable = stack.getComponent?.("minecraft:enchantable") as { getEnchantments?(): unknown[] } | undefined;
  if ((enchantable?.getEnchantments?.() ?? []).length > 0) return false;
  const durability = stack.getComponent?.("minecraft:durability") as { damage?: number } | undefined;
  if ((durability?.damage ?? 0) > 0) return false;
  return true;
}

function pickUp(entity: Entity, itemEntity: Entity) {
  if (!entity.isValid || !itemEntity.isValid || mouthItem(entity)) return;
  const stack = itemEntity.getComponent("minecraft:item")?.itemStack;
  if (!stack || !isPlainStack(stack as unknown as PlainStackProbe)) return;
  const id = stack.typeId;
  const location = itemEntity.location;
  const dimension = itemEntity.dimension;
  // Primeiro põe na boca; o item do chão só some depois que isso deu certo (senão o item seria perdido).
  setMouth(entity, id);
  try {
    itemEntity.remove();
  }
  catch (e) {
    // Não conseguiu tirar do chão: desfaz a boca para não duplicar o item.
    setMouth(entity, undefined);
    throw e;
  }
  if (stack.amount > 1) {
    const rest = stack.clone();
    rest.amount = stack.amount - 1;
    dimension.spawnItem(rest, location);
  }
  const heal = foxFoodHeal(id);
  if (heal <= 0) return;
  const entityId = entity.id;
  system.runTimeout(() => {
    const fox = world.getEntity(entityId);
    if (!fox?.isValid || mouthItem(fox) !== id) return;
    setMouth(fox, undefined);
    const health = fox.getComponent("minecraft:health");
    if (health) health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + heal));
    fox.dimension.playSound("random.eat", fox.location);
  }, EAT_DELAY_TICKS);
}

let started = false;

export function startSpeciesBehaviours() {
  if (started) return;
  started = true;
  world.afterEvents.dataDrivenEntityTrigger.subscribe(({ entity, eventId }) => {
    try { onBeeEvent(entity, eventId); }
    catch (e) { console.warn(`[mundo-detalhes] abelha: ${e}`); }
  }, { eventTypes: ["cobblemon:bee_collected_nectar", "cobblemon:bee_deposit"] });
  world.beforeEvents.entityItemPickup.subscribe(event => {
    const { entity, item } = event;
    if (!PICKUP.has(speciesIdOfType(entity.typeId))) return;
    // O motor nunca pega sozinho: a coleta é do script (item na boca; o item segurado fica só nos dados).
    event.cancel = true;
    if (entity.getProperty("cobblemon:wild") !== true || entity.getDynamicProperty(MOUTH_PROPERTY)) return;
    system.run(() => {
      try { pickUp(entity, item); }
      catch (e) { console.warn(`[mundo-detalhes] raposa: ${e}`); }
    });
  }, { entityFilter: { families: ["pokemon"] } });
}
