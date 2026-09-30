import { Block, BlockComponentPlayerInteractEvent, BlockComponentRandomTickEvent, BlockCustomComponent, EntityInventoryComponent, ItemStack, StructureManager, Vector3 } from "@minecraft/server";
import { decrementItemInHand } from "../utils/ItemUtils";

/** Ticks aleatórios do Java por tick aleatório do Bedrock (randomTickSpeed padrão: 3 no Java, 1 no Bedrock). */
export const JAVA_RANDOM_TICKS_PER_BEDROCK = 3;
/**
 * Chance por tick aleatório do Bedrock de algo que no Java tem chance `p` por tick aleatório. Os 3 ticks do Java caem em
 * blocos sorteados independentemente: um bloco recebe em média 3 ticks do Java por tick do Bedrock, e o que tem de bater
 * é o número esperado de avanços (3p), não "pelo menos um sucesso em 3" (que ficaria 16–23% mais lento).
 */
export function perBedrockRandomTick(p: number): number {
  return Math.min(1, JAVA_RANDOM_TICKS_PER_BEDROCK * p);
}
/** SaplingBlock (vanilla, base do ApricornSaplingBlock): `nextInt(7) == 0` com luz ≥ 9 em cima; 2 estágios (0 → 1 → árvore). */
export const SAPLING_GROW_CHANCE = perBedrockRandomTick(1 / 7);
export const SAPLING_MIN_LIGHT = 9;
/** SaplingBlock.isBonemealSuccess: 45% por farinha de osso (a farinha é gasta mesmo sem avançar). */
export const SAPLING_BONEMEAL_CHANCE = 0.45;

export default class SaplingComponent implements BlockCustomComponent {
  /**
   * Component used for saplings
   * @param structureID Structure to load when the sapling grows
   * @param offset Offset from corner to place the structure
   * @param chanceToGrowPerRandomTick Chance to grow per random tick
   * @param maxGrowth Maximum growth state
   * @param growthBlockState id of state used to keep track of growth
   */
  constructor(
    public structureID: string,
    public offset: Vector3 = { x: -3, y: 0, z: -3 },
    public chanceToGrowPerRandomTick = SAPLING_GROW_CHANCE,
    // STAGE do SaplingBlock: 0 → 1 → árvore (o estado do bloco vai até 3, mas o Java só usa 2 passos).
    public maxGrowth = 1,
    public growthBlockState = "cobblemon:growth_state"
  ) { }
  becomeTree(block: Block) {
    //I have no idea how you are supposed to get an instance of the StructureManager class.
    block.dimension.runCommand(`structure load ${this.structureID} ${block.location.x + this.offset.x} ${block.location.y + this.offset.y} ${block.location.z + this.offset.z}`);
  }
  grow(block: Block) {
    let currentGrowthState = block.permutation.getState(this.growthBlockState);
    if (typeof currentGrowthState == "number") {
      if (currentGrowthState < (this.maxGrowth)) {
        block.setPermutation(block.permutation.withState(this.growthBlockState, currentGrowthState + 1));
      }
      // ≥: mudas plantadas antes (estágios 2 e 3 da regra antiga) viram árvore no próximo passo.
      else if (currentGrowthState >= this.maxGrowth) {
        this.becomeTree(block);
      }
    }
  }
  onRandomTick(arg: BlockComponentRandomTickEvent) {
    let light = 15;
    try { light = arg.block.above()?.getLightLevel() ?? 15; } catch { /* topo do mundo / chunk: não bloqueia */ }
    if (light < SAPLING_MIN_LIGHT) return;
    if (Math.random() < this.chanceToGrowPerRandomTick)
      this.grow(arg.block);
  }
  onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
    if (arg.player == undefined)
      return;
    let inventory = arg.player.getComponent("minecraft:inventory") as EntityInventoryComponent;
    let currentSlot = inventory.container!.getSlot(arg.player.selectedSlotIndex);
    let currentItem = currentSlot.getItem();
    let currentGrowthState = arg.block.permutation.getState(this.growthBlockState);
    //If there's nothing in their hand
    if (currentItem == undefined)
      return;
    if (typeof currentGrowthState != "number")
      throw new Error(`Block ${arg.block.typeId} does not have growth state ${this.growthBlockState}`);
    // SaplingBlock.isValidBonemealTarget é sempre true (inclui mudas dos estágios antigos 2 e 3).
    if (currentItem.typeId == "minecraft:bone_meal") {

      decrementItemInHand(arg.player);
      if (Math.random() < SAPLING_BONEMEAL_CHANCE) this.grow(arg.block);
      arg.dimension.spawnParticle("minecraft:crop_growth_emitter", arg.block.location);
      arg.dimension.playSound("item.bone_meal.use", arg.block.location);
    }
  }
}