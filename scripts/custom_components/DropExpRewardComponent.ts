import { BlockComponentPlayerBreakEvent, BlockCustomComponent, GameMode } from "@minecraft/server";

export default class DropExpRewardComponent implements BlockCustomComponent {
  onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
    if (arg.player?.getGameMode() == GameMode.Creative)
      return;
    for (let i = 0; i < Math.random() * 3; i++) {
      arg.dimension.spawnEntity("minecraft:xp_orb", arg.block.location);
    }
  }
}