import { BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, BlockCustomComponent, GameMode, ItemStack } from "@minecraft/server";
import { decrementItemInHand, getItemInHand } from "../utils/ItemUtils"
import { changeBlockState } from "../utils/BlockUtils"

export default class SlabComponent implements BlockCustomComponent {
  constructor(
    public blockIdentifier: string,
    public placeSound: string
  ) { }
  onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
    if (arg.player === undefined)
      return;
    if (arg.block.permutation.getState("cobblemon:double") === true)
      return;
    var item = getItemInHand(arg.player);
    if (item != undefined && item.typeId == this.blockIdentifier) {
      changeBlockState(arg.block, "cobblemon:double", true);
      decrementItemInHand(arg.player);
      arg.dimension.playSound(this.placeSound, arg.block.location);
    }
  }
  onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
    if (arg.player != undefined && arg.player.getGameMode() == GameMode.Creative)
      return;
    if (arg.brokenBlockPermutation.getState("cobblemon:double") === true) {
      arg.dimension.spawnItem(new ItemStack(this.blockIdentifier, 2), arg.block.location);
    }
    else {
      arg.dimension.spawnItem(new ItemStack(this.blockIdentifier), arg.block.location);
    }
  }
}