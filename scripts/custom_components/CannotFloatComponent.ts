import { BlockComponentTickEvent, BlockCustomComponent } from "@minecraft/server";
import { BlockUtils } from "../utils";


export default class CannotFloatComponent implements BlockCustomComponent {
  onTick(arg: BlockComponentTickEvent) {
    let belowBlock = arg.block.below(1);
    if (belowBlock === undefined || belowBlock.isAir || belowBlock.isLiquid) {
      BlockUtils.destroy(arg.block);
    }
  }
}