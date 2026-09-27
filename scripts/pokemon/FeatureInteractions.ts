/**
 * Interações com o Pokémon em campo ligadas às features (PokemonEntity.mobInteract do Cobblemon 1.8.2):
 *
 * - Tesoura no Slowpoke (dono ou selvagem) com a cauda crescida: som de tosquia, dropa 1 Tasty Tail
 *   (SlowpokeTailRegrowthSpeciesFeature.onShear), a cauda leva 1200 s para crescer e a tesoura perde 1 de durabilidade.
 * - Stash (StashHandler.interactMob): o dono, sem agachar, dá Relic Coin/Pouch/Sack ou netherite ao Gimmighoul; os
 *   pontos entram no stash, o item é gasto (1) e toca `pokemon.gimmighoul.give_item`.
 */
import { Entity, GameMode, ItemStack, Player } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { STASH_SOUND, TASTY_TAIL, canShearTail, getIntFeature, handleStashItem, isStashItem, shearTail } from "./SpeciesFeatures";

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

/** Salva os dados na entidade e no time do dono. */
function save(entity: Entity, data: PokemonData) {
  entity.setDynamicProperty("data", JSON.stringify(data));
  data.tryUpdatePokemonInTeam();
  data.tryUpdatePokemonOut();
}

/** Gasta 1 de durabilidade da tesoura na mão (hurtAndBreak(1)). */
function damageShears(player: Player) {
  if (isCreative(player)) return;
  const slot = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const stack = slot?.getItem();
  if (!slot || !stack) return;
  const durability = stack.getComponent("minecraft:durability");
  if (!durability) return;
  if (durability.damage + 1 >= durability.maxDurability) {
    slot.setItem(undefined);
    try { player.playSound("random.break"); } catch { }
    return;
  }
  durability.damage += 1;
  slot.setItem(stack);
}

/** Tesoura no Slowpoke. Retorna true se tratou a interação. */
export function trySlowpokeShear(player: Player, entity: Entity, heldItem: ItemStack | undefined): boolean {
  if (heldItem?.typeId !== "minecraft:shears") return false;
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data || !canShearTail(data)) return false;
  // Dono ou selvagem (ownerUUID == player.uuid || ownerUUID == null).
  const owner = entity.getDynamicProperty("owner_name");
  if (owner !== undefined && owner !== player.name) return false;
  if (entity.getProperty("cobblemon:in_battle") === true) return false;
  try { entity.dimension.playSound("mob.sheep.shear", entity.location); } catch { }
  shearTail(data);
  save(entity, data);
  try { entity.dimension.spawnItem(new ItemStack(TASTY_TAIL, 1), { ...entity.location, y: entity.location.y + 1 }); }
  catch (e) { console.warn(`Tasty Tail: ${e}`); }
  damageShears(player);
  return true;
}

/** Stash do Gimmighoul. Retorna true se tratou a interação. */
export function tryStashItem(player: Player, entity: Entity, heldItem: ItemStack | undefined): boolean {
  if (!heldItem || player.isSneaking) return false;
  if (entity.getDynamicProperty("owner_name") !== player.name) return false;
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data || !isStashItem(data, heldItem.typeId)) return false;
  if (!handleStashItem(data, heldItem.typeId)) return false;
  save(entity, data);
  if (!isCreative(player)) {
    const slot = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
    const stack = slot?.getItem();
    if (slot && stack?.typeId === heldItem.typeId) {
      if (stack.amount > 1) slot.amount = stack.amount - 1;
      else slot.setItem(undefined);
    }
  }
  try { entity.dimension.playSound(STASH_SOUND, entity.location); } catch { }
  // Mostra o stash atual (o Cobblemon mostra no resumo; o port avisa na actionbar).
  const coins = getIntFeature(data, "gimmighoul_coins");
  const scrap = getIntFeature(data, "gimmighoul_netherite");
  try {
    player.onScreenDisplay.setActionBar({
      rawtext: [
        { translate: "cobblemon.ui.stash.gold" }, { text: `: ${coins ?? 0}/999  ` },
        { translate: "cobblemon.ui.stash.netherite" }, { text: `: ${scrap ?? 0}/256` },
      ],
    });
  } catch { }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Tingir (feature `color`: Conkeldurr, Wooloo e Dubwool; 1.5.1)

/** species_feature_assignments/color.json. */
export const COLORABLE_SPECIES = ["conkeldurr", "wooloo", "dubwool"];
export const DYE_COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan",
  "purple", "blue", "brown", "green", "red", "black"];

/** Cor do corante (DyeItem.dyeColor) ou undefined. Só os 16 `*_dye` (como os DyeItem do Java). */
export function dyeColorOf(typeId: string | undefined): string | undefined {
  const match = /^minecraft:(\w+)_dye$/.exec(typeId ?? "");
  return match && DYE_COLORS.includes(match[1]) ? match[1] : undefined;
}

/** Troca o aspect `color-*` (ChoiceSpeciesFeature com aspectFormat "color-{{choice}}"). Undefined = sem cor. */
export function setColorAspect(pokemon: Pick<PokemonData, "aspects">, color: string | undefined) {
  pokemon.aspects = pokemon.aspects.filter(aspect => !aspect.startsWith("color-")).concat(color ? [`color-${color}`] : []);
}

/**
 * PokemonEntity.mobInteract (corante / balde de água) no dono ou selvagem com a feature de cor.
 * Corante de outra cor: tinge e gasta 1 (fora do criativo). Balde de água: tira a cor e vira balde vazio.
 */
export function tryDyePokemon(player: Player, entity: Entity, heldItem: ItemStack | undefined): boolean {
  if (!heldItem) return false;
  const owner = entity.getDynamicProperty("owner_name");
  if (owner !== undefined && owner !== player.name) return false;
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data || !COLORABLE_SPECIES.includes(data.species.replace(/^cobblemon:/, ""))) return false;
  const current = data.aspects.find(aspect => aspect.startsWith("color-"))?.slice("color-".length) ?? "";
  const slot = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const dye = dyeColorOf(heldItem.typeId);
  if (dye) {
    if (dye === current) return false;
    setColorAspect(data, dye);
    save(entity, data);
    if (!isCreative(player) && slot?.getItem()?.typeId === heldItem.typeId) {
      const stack = slot.getItem()!;
      if (stack.amount > 1) slot.amount = stack.amount - 1;
      else slot.setItem(undefined);
    }
    return true;
  }
  if (heldItem.typeId === "minecraft:water_bucket") {
    if (current) {
      setColorAspect(data, undefined);
      save(entity, data);
      if (!isCreative(player) && slot) slot.setItem(new ItemStack("minecraft:bucket", 1));
    }
    return true;
  }
  return false;
}
